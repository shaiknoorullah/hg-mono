// Command hg is the Halal Goes API server.
//
// It is one binary containing every module as a package. The modules are
// separated by their dependencies and their spec sections, not by a network hop:
// nothing here is a microservice, and the layout is designed so that extracting
// one later is a build change rather than a rewrite.
//
// Boot order, and every step is a fail-loud gate:
//
//  1. Load configuration. A missing required variable exits non-zero with the
//     variable's name (G-7).
//  2. Open every dependency. A dependency that will not answer is a failed boot,
//     not a degraded server that reports healthy.
//  3. Run the G-7 startup self-probes. Outside local, a failure is fatal.
//  4. Register routes and verify every policy. A route with no policy panics the
//     boot rather than serving unguarded (G-4 / I-06.1).
//  5. Serve, and shut down gracefully on SIGINT/SIGTERM.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/account"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/addresses"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/admin"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/files"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/rider"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/system"
)

// orderRealtimeEmitter bridges the orders module to the realtime module: it
// implements orders.EventEmitter by calling realtime.EmitInTx inside the
// caller's transaction, so the outbox event and the state change commit
// atomically (the transactional outbox). The store field is set once
// realtime.NewStore is called in run() and before the HTTP server starts, so
// it is always non-nil by the time any Transition can run.
type orderRealtimeEmitter struct {
	store *realtime.Store
}

func (e *orderRealtimeEmitter) EmitOrderTransition(ctx context.Context, tx pgx.Tx, orderID, newState string) error {
	payload, err := json.Marshal(struct {
		State string `json:"state"`
	}{State: newState})
	if err != nil {
		return fmt.Errorf("marshal order transition payload: %w", err)
	}
	oid := orderID
	_, _, err = realtime.EmitInTx(ctx, tx,
		"order:"+orderID,
		"order.state_changed",
		1,
		nil,
		json.RawMessage(payload),
		&oid,
		nil,
	)
	return err
}

// orderPaymentGateway bridges the orders module to the payments sibling: it
// implements orders.PaymentGateway by asking the payments service to authorise
// a manual-capture PaymentIntent for the order (P-16 step 3/4).
//
// advanceLocal is set only in local/fake-Stripe mode: production advances the
// order past authorisation via the Stripe webhook (amount_capturable_updated),
// which the fake client cannot send, so we advance CREATED→AUTHORIZED→
// RESTAURANT_PENDING synchronously here instead. It is never set with a real key.
type orderPaymentGateway struct {
	svc          *payments.Service
	store        *orders.Store
	advanceLocal bool
}

// restaurantPayAdapter implements restaurant.PaymentActions over the payments
// sibling service. It discards the returned IntentRow (the restaurant module
// does not need it) and returns only the error. Both methods are idempotent and
// keyed by order ID (P-16 / invariant 5).
type restaurantPayAdapter struct {
	svc *payments.Service
}

func (a restaurantPayAdapter) Capture(ctx context.Context, orderID string, amountCents int64) error {
	_, err := a.svc.Capture(ctx, orderID, amountCents)
	return err
}

func (a restaurantPayAdapter) Void(ctx context.Context, orderID string) error {
	_, err := a.svc.Void(ctx, orderID)
	return err
}

func (g orderPaymentGateway) CreateOrderIntent(ctx context.Context, in orders.CreateIntentInput) (orders.CreateIntentResult, error) {
	method := ""
	if in.PaymentMethodID != nil {
		method = *in.PaymentMethodID
	}
	row, err := g.svc.Authorise(ctx, payments.AuthoriseInput{
		OrderID:        in.OrderID,
		AmountCents:    in.AmountCents,
		Currency:       in.Currency,
		StripeMethod:   method,
		IdempotencyKey: "order:" + in.OrderID,
	})
	if err != nil {
		return orders.CreateIntentResult{}, err
	}
	if g.advanceLocal {
		_ = g.store.Transition(ctx, orders.TransitionRequest{
			OrderID: in.OrderID, To: machine.StateAuthorized, Actor: machine.ActorSystem,
			Reason: "payment authorised (local fake)",
		})
		_ = g.store.Transition(ctx, orders.TransitionRequest{
			OrderID: in.OrderID, To: machine.StateRestaurantPending, Actor: machine.ActorSystem,
			Reason: "presented to restaurant",
		})
	}
	return orders.CreateIntentResult{ClientSecret: row.StripePaymentIntentID + "_secret"}, nil
}

func main() {
	if err := run(); err != nil {
		// Boot failures go to stderr in plain text as well as the structured
		// log: a container that dies in three seconds is read with `docker logs`,
		// and a JSON blob is the wrong shape for that moment.
		fmt.Fprintf(os.Stderr, "hg: fatal: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	startedAt := time.Now().UTC()

	// 1. Configuration. Nothing is logged before this, because the log level
	// itself is configuration.
	cfg, err := config.LoadFromOS()
	if err != nil {
		return err
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	slog.SetDefault(log)
	log = log.With(
		slog.String("service", "hg-api"),
		slog.String("version", cfg.ServiceVersion),
		slog.String("env", string(cfg.Env)),
	)

	// The root context is cancelled by SIGINT/SIGTERM and is the parent of every
	// operation the process performs, so a shutdown propagates everywhere.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Info("configuration loaded",
		slog.String("http_addr", cfg.HTTPAddr),
		slog.String("postgres", cfg.Postgres.Host()),
		slog.String("redis", cfg.Redis.Addr),
		slog.String("minio", cfg.MinIO.Endpoint),
		slog.Int("cors_origins", len(cfg.CORSOrigins)))

	// 2. Dependencies. Open dials all three and fails rather than returning a
	// half-connected Store.
	dialCtx, cancelDial := context.WithTimeout(ctx, 30*time.Second)
	defer cancelDial()

	st, err := store.Open(dialCtx, cfg, log)
	if err != nil {
		return fmt.Errorf("dependencies unreachable: %w", err)
	}
	defer st.Close()

	for _, d := range st.Check(ctx).Dependencies {
		log.Info("dependency connected",
			slog.String("name", d.Name),
			slog.String("configured", d.ConfiguredAddress),
			slog.String("connected_to", d.ResolvedAddress),
			slog.Bool("live", d.Connected))
	}

	// 3. G-7 startup self-probes.
	probes := st.BootProbes(ctx)
	for _, p := range probes {
		lvl := slog.LevelInfo
		if !p.Passed {
			lvl = slog.LevelWarn
		}
		log.Log(ctx, lvl, "boot probe",
			slog.String("name", p.Name),
			slog.Bool("passed", p.Passed),
			slog.String("detail", p.Detail))
	}
	if err := st.FatalProbeError(probes); err != nil {
		return err
	}

	// 4. Routes. Every module contributes a Routes(router, …) function; every
	// route carries a Policy; Verify refuses to boot on a defective one.
	//
	// B3 (auth) provides the real P-04 token authenticator and the P-05
	// role→action matrix, replacing the AnonymousAuthenticator/DenyAllAuthorizer
	// stubs. Its secrets are loaded from the environment here (fail-loud, G-7).
	authSecrets, err := auth.LoadSecrets(os.Getenv, !cfg.Env.IsLocal())
	if err != nil {
		return err
	}
	authModule := auth.NewModule(
		st.DB().Pool, st.Cache().Client, authSecrets,
		nil, cfg.Env.IsLocal(), log)

	router := httpx.NewRouter(httpx.Options{
		Logger:        log,
		Env:           string(cfg.Env),
		CORSOrigins:   cfg.CORSOrigins,
		Authenticator: authModule.Authenticator,
		Authorizer:    authModule.Authorizer,
	})

	system.Routes(router, system.NewHandler(cfg, st, startedAt, probes), cfg)
	auth.Routes(router, authModule.Handler)

	// B2 — Customer delivery addresses (internal/addresses, P-30).
	addresses.Routes(router, addresses.NewHandler(addresses.NewRepo(st.DB().Pool)))
	// B2 — Account self-service (C-03, P-24, P-25): profile, devices, notifications.
	account.Routes(router, account.NewHandler(account.NewRepo(st.DB().Pool)))
	// The revocation deny set refreshes from Postgres every 10 s (P-04).
	authModule.StartRevocationRefresher(ctx)
	// TODO(siblings): catalog.Routes(router, …), orders.Routes(router, …),
	// B4 — Catalogue & discovery. The media resolver is left nil until the files
	// module lands (a nil media renders every image as null, a neutral placeholder
	// per the contract). The staff-scope resolver reads the P-01 account_role table
	// directly, so the restaurant-facing trading routes (availability, heartbeat)
	// resolve the caller's restaurant from the server's own view of the grant —
	// never a client-asserted id — and deny when no live RESTAURANT-scoped grant
	// exists.
	catalogRepo := catalog.NewRepo(st.DB().Pool)
	catalog.Routes(router, catalog.NewHandler(
		catalogRepo,
		nil,
		catalog.NewMinIOPresigner(st.Objects()),
		catalog.NewPgScopeResolver(catalogRepo),
	))
	// TODO(siblings): auth.Routes(router, …), orders.Routes(router, …),

	// B5 — cart, quote and orders. The payment gateway is the payments sibling's
	// to provide; until it is wired, orders uses the honest unwired gateway that
	// 503s rather than fabricating a client_secret, and createOrder answers 503.
	//
	// The realtime emitter (Seam C) is created now and its store field is set
	// after rtStore is built (B8 below). The HTTP server starts only after all
	// wiring completes, so emitter.store is always non-nil before any Transition
	// can be called.
	rtEmitter := &orderRealtimeEmitter{}
	ordersStore := orders.NewStore(st.DB().Pool, rtEmitter)
	// The orders handler + P-15 deadline runner are wired just below, AFTER the
	// payments service, so createOrder can ask the payments gateway for a real
	// PaymentIntent (P-16 3/4) rather than the unwired nil gateway.

	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// dispatch.Routes(router, …), payments.Routes(router, …),

	// B6 — payments, ledger & payouts (P-16..P-21). The Stripe client is the
	// live SDK when a key is configured, and nil otherwise; a nil client makes
	// every money operation answer 503 rather than fabricating a provider id,
	// which is the exact anti-pattern this module replaces. Read paths (saved
	// cards, refund history, earnings, payouts) work regardless.
	var stripeClient payments.StripeClient
	if cfg.Stripe.Configured() {
		stripeClient = payments.NewLiveStripe(cfg.Stripe.SecretKey, cfg.Stripe.WebhookSecret)
		log.Info("stripe configured",
			slog.Bool("livemode", cfg.Stripe.LiveMode()),
			slog.Bool("webhook_secret_set", cfg.Stripe.WebhookSecret != ""))
	} else if cfg.Env.IsLocal() {
		// Local dev only: a fake payment client so orders can be placed end-to-end
		// without real Stripe credentials. Never reachable outside local env.
		stripeClient = payments.NewFakeStripe()
		log.Warn("stripe NOT configured — using LOCAL FAKE payment client (dev only, never production)")
	} else {
		log.Warn("stripe not configured — payment mutation routes answer 503 (HG_STRIPE_SECRET_KEY unset)")
	}
	paymentsSvc := payments.NewService(payments.NewRepo(st.DB().Pool), stripeClient, cfg.Stripe, log)
	payments.Routes(router, payments.NewHandler(paymentsSvc, cfg))

	// Wire orders to the payments gateway (deferred from B5 above): createOrder
	// now asks the payments sibling to authorise the PaymentIntent (P-16 3/4).
	orderGateway := orderPaymentGateway{svc: paymentsSvc, store: ordersStore, advanceLocal: !cfg.Stripe.Configured() && cfg.Env.IsLocal()}
	orders.Routes(router, orders.NewHandler(ordersStore, orderGateway, log))
	deadlineRunner := orders.NewDeadlineRunner(ordersStore, orderGateway, log, cfg.HTTPAddr)
	go deadlineRunner.Run(ctx)

	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// orders.Routes(router, …), dispatch.Routes(router, …),
	dispatch.Routes(router, dispatch.NewHandler(dispatch.NewService(dispatch.NewStore(st.DB().Pool))))

	// B7 — Restaurant partner portal (R-01…R-26).
	// Scope resolver reads account_role; ownership enforced in SQL (P-07 / IDOR).
	// restaurantPay bridges restaurant.PaymentActions to the payments sibling so
	// AcceptOrder captures (T6) and RejectOrder voids (T7) without importing the
	// payments package from the restaurant package (modular-monolith seam).
	restaurantRepo := restaurant.NewRepo(st.DB().Pool)
	restaurantPay := restaurantPayAdapter{svc: paymentsSvc}
	restaurant.Routes(router, restaurant.NewHandler(restaurantRepo, nil, restaurantPay))

	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// orders.Routes(router, …), payments.Routes(router, …),
	// realtime.Routes(router, …), files.Routes(router, …), admin.Routes(router, …).

	// B8 Realtime. The gateway fans events out over Redis to the local sockets;
	// the relay pumps the transactional outbox into Redis; both run for the life
	// of the process and are stopped on shutdown. Node id names this replica in
	// realtime_connection and the outbox lease.
	nodeID := cfg.ServiceVersion + "@" + cfg.HTTPAddr
	rtStore := realtime.NewStore(st.DB().Pool, nodeID)
	// Complete the Seam C wiring: orders.Store now emits realtime outbox events
	// on every state transition via the transactional outbox (I-15 / §6.1).
	rtEmitter.store = rtStore
	rtGateway := realtime.NewGateway(rtStore, st.Cache().Client, log, nil)
	rtRelay := realtime.NewRelay(st.DB().Pool, st.Cache().Client, log, nodeID)
	realtime.Routes(router, realtime.NewHandler(rtStore, rtGateway, log, cfg.CORSOrigins))
	go rtGateway.Run(ctx)
	go rtRelay.Run(ctx)
	defer rtGateway.Shutdown()

	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// orders.Routes(router, …), dispatch.Routes(router, …),
	// payments.Routes(router, …), files.Routes(router, …), admin.Routes(router, …).

	// B10 — Rider self-service (internal/rider).
	rider.Routes(router, rider.NewHandler(rider.NewService(rider.NewRepo(st.DB().Pool))))

	// B9 — Admin, RBAC & files (internal/admin, internal/files).
	admin.Routes(router, admin.NewHandler(admin.NewRepo(st.DB().Pool), admin.DefaultConfig()))
	files.Routes(router, files.NewHandler(files.NewRepo(
		st.DB().Pool,
		st.Objects().Client,
		files.NewMinIOObjectStore(st.Objects().Client),
		files.Buckets{
			KYC:     cfg.MinIO.Buckets.KYC,
			POD:     cfg.MinIO.Buckets.POD,
			Media:   cfg.MinIO.Buckets.Media,
			Exports: cfg.MinIO.Buckets.Exports,
			Tmp:     cfg.MinIO.Buckets.Tmp,
		},
	)))
	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// orders.Routes(router, …), dispatch.Routes(router, …),
	// payments.Routes(router, …), realtime.Routes(router, …).

	if err := router.Verify(); err != nil {
		return err
	}
	log.Info("routes registered",
		slog.Int("total", len(router.Routes())),
		slog.Any("public", router.PublicRoutes()))

	// 5. Serve.
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(ln net.Listener) context.Context { return ctx },
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
	}

	serveErr := make(chan error, 1)
	go func() {
		log.Info("listening", slog.String("addr", cfg.HTTPAddr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		if err != nil {
			return fmt.Errorf("http server: %w", err)
		}
		return nil
	case <-ctx.Done():
		stop() // restore default signal handling: a second Ctrl-C kills immediately
	}

	// Graceful shutdown: stop accepting, let in-flight requests finish inside the
	// budget, then close dependencies. Traefik has already been told this replica
	// is unready by /health/ready failing once the listener stops.
	log.Info("shutdown signalled", slog.Duration("grace", cfg.ShutdownTimeout))

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("graceful shutdown exceeded its budget; forcing close",
			slog.String("error", err.Error()))
		_ = srv.Close()
	}
	st.Close()
	log.Info("stopped")
	return nil
}
