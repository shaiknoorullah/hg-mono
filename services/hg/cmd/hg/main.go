// Command hg is the HalalGoes API server.
//
// `hg stripe-catchup --since <time>` instead runs the on-demand Stripe
// catch-up after a failover or restore, and exits (stripe_catchup.go).
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
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/account"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/addresses"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/admin"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/dispatch"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/files"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/halalexpiry"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/handoff"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify/emailtmpl"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/machine"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/partitions"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/retention"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/rider"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/system"
)

// orderRealtimeEmitter implements orders.EventEmitter: it writes the
// order-lifecycle notifications inside the transition's transaction. The
// realtime events themselves are written by orders.Transition directly, in the
// contract's shapes (internal/orders/events.go;
// https://github.com/shaiknoorullah/hg-mono/issues/247), so this type no longer
// touches the realtime outbox.
type orderRealtimeEmitter struct {
	// store is no longer read: the realtime write moved into orders.Transition.
	// It goes when the realtime wiring in run() is next edited (open
	// https://github.com/shaiknoorullah/hg-mono/pull/291 edits those lines).
	store *realtime.Store
	// notify is the transactional-outbox enqueuer (P-24). It is optional: when
	// nil (e.g. a build without the notify module wired) EmitOrderTransition
	// does nothing. When set, the order-lifecycle notification is written into
	// the SAME tx as the state change, so it commits or rolls back atomically
	// with the transition (notify/doc.go: a notification is a row first, a
	// delivery attempt second).
	notify *notify.Enqueuer
}

func (e *orderRealtimeEmitter) EmitOrderTransition(ctx context.Context, tx pgx.Tx, orderID, newState string) error {
	if e.notify == nil {
		return nil
	}
	return e.enqueueLifecycleNotification(ctx, tx, orderID, newState)
}

// enqueueLifecycleNotification maps an order state transition to its notify
// builder(s) and enqueues them inside the transition tx. Order details (code,
// customer account, restaurant id/name, deadline_at) are read from the SAME
// tx so they reflect exactly the committing state.
//
// Most transitions notify the customer (the order's own account_id). Two
// transitions notify a different party entirely, against their own recipient
// account(s), still inside this same seam and the same tx so the alert is
// atomic with the state change (CLAUDE.md invariant 4 — no "waits forever"
// state where the transition committed but nobody was ever told):
//
//   - RESTAURANT_PENDING: the restaurant needs to respond (NotifyOrderPlaced),
//     recipient = every live RESTAURANT-scoped staff account for the order's
//     restaurant_id (account_role, not the order's own account_id).
//   - READY_FOR_PICKUP: the assigned rider needs to know the order is ready
//     (NotifyOrderReady), recipient = the order's live assignment's
//     rider_account_id.
func (e *orderRealtimeEmitter) enqueueLifecycleNotification(ctx context.Context, tx pgx.Tx, orderID, newState string) error {
	oid, err := uuid.Parse(orderID)
	if err != nil {
		return fmt.Errorf("notify: parse order id %q: %w", orderID, err)
	}

	var (
		code           string
		accountID      uuid.UUID
		restaurantID   uuid.UUID
		restaurantName string
		deadlineAt     *time.Time
		rejectReason   *string
		cancelReason   *string
	)
	if err := tx.QueryRow(ctx, `
		SELECT o.code, o.account_id, o.restaurant_id, o.deadline_at, r.display_name,
		       o.reject_reason::text, o.cancel_reason::text
		  FROM "order" o
		  JOIN restaurant r ON r.id = o.restaurant_id
		 WHERE o.id = $1`, oid).
		Scan(&code, &accountID, &restaurantID, &deadlineAt, &restaurantName, &rejectReason, &cancelReason); err != nil {
		return fmt.Errorf("notify: load order %s for lifecycle notification: %w", orderID, err)
	}

	ev := notify.OrderEvent{
		OrderID:        oid,
		OrderShortCode: code,
		AccountID:      accountID,
		RestaurantName: restaurantName,
	}
	if deadlineAt != nil {
		ev.DeadlineAt = *deadlineAt
	}

	switch machine.State(newState) {
	case machine.StateRestaurantPending:
		// T5: the order was just offered to the restaurant. Fan out to every
		// live RESTAURANT-scoped staff account so someone at the restaurant
		// sees it — a missing recipient here is the "waits forever" state
		// deadline_at exists to make unrepresentable.
		return e.notifyRestaurantStaff(ctx, tx, restaurantID, ev)
	case machine.StatePreparing:
		// T6: RESTAURANT_PENDING -> PREPARING is the restaurant accepting and
		// the capture point (invariant 5). This is the customer's "accepted".
		_, err = e.notify.Enqueue(ctx, tx, notify.NotifyOrderAccepted(ev))
		return err
	case machine.StateRejected:
		_, err = e.notify.Enqueue(ctx, tx, notify.NotifyOrderRejected(ev, deref(rejectReason)))
		return err
	case machine.StateReadyForPickup:
		return e.notifyAssignedRider(ctx, tx, oid, ev)
	case machine.StatePickedUp:
		_, err = e.notify.Enqueue(ctx, tx, notify.NotifyOrderPickedUp(ev))
		return err
	case machine.StateDelivered:
		_, err = e.notify.Enqueue(ctx, tx, notify.NotifyOrderDelivered(ev))
		return err
	case machine.StateCancelled:
		_, err = e.notify.Enqueue(ctx, tx, notify.NotifyOrderCancelled(ev, deref(cancelReason)))
		return err
	default:
		return nil // no notification for this transition
	}
}

// notifyRestaurantStaff enqueues NotifyOrderPlaced against every account with
// a live RESTAURANT_OWNER/RESTAURANT_MANAGER/RESTAURANT_STAFF account_role
// grant scoped to restaurantID (mirrors internal/restaurant.Repo's own
// resolution of "who may act for this restaurant" — P-07 ownership, never a
// restaurant-id lifted from the request body). ev.AccountID is overwritten
// per staff account; the DedupeKey ("order_placed:<order_id>") is scoped per
// (account_id, dedupe_key) so each staff member gets exactly one row even if
// this fires more than once.
func (e *orderRealtimeEmitter) notifyRestaurantStaff(ctx context.Context, tx pgx.Tx, restaurantID uuid.UUID, ev notify.OrderEvent) error {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT account_id
		  FROM account_role
		 WHERE scope_type = 'RESTAURANT'
		   AND scope_id = $1
		   AND role::text = ANY($2)
		   AND revoked_at IS NULL`,
		restaurantID, []string{"RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF"})
	if err != nil {
		return fmt.Errorf("notify: load restaurant staff for %s: %w", restaurantID, err)
	}
	defer rows.Close()

	var staffIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("notify: scan restaurant staff account: %w", err)
		}
		staffIDs = append(staffIDs, id)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("notify: iterate restaurant staff: %w", err)
	}

	for _, id := range staffIDs {
		staffEv := ev
		staffEv.AccountID = id
		if _, err := e.notify.Enqueue(ctx, tx, notify.NotifyOrderPlaced(staffEv)); err != nil {
			return fmt.Errorf("notify: enqueue order_placed for staff %s: %w", id, err)
		}
	}
	return nil
}

// notifyAssignedRider enqueues NotifyOrderReady against the order's live
// (terminated_at IS NULL) assignment's rider_account_id. No live assignment
// (e.g. dispatch has not yet matched a rider by the time the restaurant marks
// ready) is a deliberate no-op: there is no recipient to tell yet, and the
// dispatch module's own ready-check drives the rider once one is assigned.
// Nor is a rider who already has the food told it is ready: a pickup before
// the kitchen tapped ready marks the order ready in the pickup's own
// transaction (orders.Store.PickUpTx).
func (e *orderRealtimeEmitter) notifyAssignedRider(ctx context.Context, tx pgx.Tx, orderID uuid.UUID, ev notify.OrderEvent) error {
	var riderAccountID uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT rider_account_id
		  FROM assignment
		 WHERE order_id = $1 AND terminated_at IS NULL AND picked_up_at IS NULL`, orderID).
		Scan(&riderAccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("notify: load live assignment for order %s: %w", orderID, err)
	}

	ev.AccountID = riderAccountID
	_, err = e.notify.Enqueue(ctx, tx, notify.NotifyOrderReady(ev))
	return err
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
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

// orderLifecycleAdapter implements dispatch.OrderLifecycle by forwarding to the
// orders module's Store.Transition. It is the single bridge between the dispatch
// assignment machine and the P-14 order state machine: dispatch may not write
// order.state directly; it must call through this interface (P-14).
//
// The three dispatch calls use ActorRider because each transition is triggered
// by the rider completing a physical step (picking up, arriving at the
// customer, delivering the order). The orders module validates the pair
// against the compile-time transition table, so an invalid call (e.g. wrong
// current state) returns IllegalTransitionError and the lifecycle call is a
// no-op.
type orderLifecycleAdapter struct {
	store *orders.Store
}

// ConfirmPickup is the handoff seal scan's pickup (handoff.OrderLifecycle). The
// rider's own pickup step moves the order inside its transaction instead, with
// ConfirmPickupTx (pickup.go).
func (a *orderLifecycleAdapter) ConfirmPickup(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StatePickedUp,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider confirmed pickup",
	})
}

// MarkArrived is the picked-up to arrived step, taken when the rider taps "I'm
// here" at the drop-off (issue #250). Going through Transition arms the
// 15-minute handover-overdue deadline and emits the same order.state_changed
// event as every other step.
func (a *orderLifecycleAdapter) MarkArrived(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateArrived,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider arrived at the drop-off",
	})
}

func (a *orderLifecycleAdapter) CompleteDelivery(ctx context.Context, orderID, riderAccountID string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateDelivered,
		Actor:          machine.ActorRider,
		ActorAccountID: riderAccountID,
		Reason:         "rider completed delivery",
	})
}

// OpenDispute implements handoff.OrderLifecycle's third method: a customer-filed
// tamper report advances DELIVERED or COMPLETED to DISPUTED (T19). Transition
// reads the order's *actual* current state under FOR UPDATE and validates it
// against the compile-time table itself — this adapter does not need to know
// which of the two legal predecessors the order is currently in.
func (a *orderLifecycleAdapter) OpenDispute(ctx context.Context, orderID, customerAccountID, reason string) error {
	return a.store.Transition(ctx, orders.TransitionRequest{
		OrderID:        orderID,
		To:             machine.StateDisputed,
		Actor:          machine.ActorCustomer,
		ActorAccountID: customerAccountID,
		Reason:         reason,
	})
}

func main() {
	// With no subcommand, hg is the API server. `hg stripe-catchup` is the
	// one operator command (stripe_catchup.go).
	var err error
	if len(os.Args) > 1 && os.Args[1] == "stripe-catchup" {
		err = runStripeCatchup(os.Args[2:], os.Stdout)
	} else {
		err = run()
	}
	if err != nil {
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
		slog.String("minio_presign_base", cfg.MinIO.PresignBaseURL),
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

	// Transactional notifications (docs/spec/01-platform.md, "P-24 —
	// Notification router"). The notify module enqueues a notification row and
	// a River delivery job inside the business transaction (the order emitter
	// below, auth's sign-up and reset emails, admin decisions, staff invites).
	// River's own tables ship as migration 00024_river_outbox.sql.
	//
	// Email goes through Resend when HG_RESEND_API_KEY is set (issue #59).
	// Outside production every email first passes the allow-list, so dev never
	// messages a real person (issue #235); with no key the log sender records
	// each email instead (captured in full outside production, issue #248).
	// Push (issue #58) and notification SMS (blocked on the A2P registration,
	// docs/decisions/README.md "Open — blocking") have no provider yet: their
	// deliveries are recorded SUPPRESSED and the inbox row stays the record.
	emailTemplates, err := emailtmpl.Load()
	if err != nil {
		return fmt.Errorf("notify: email templates: %w", err)
	}
	captureEmail := cfg.Env != config.EnvProduction
	var emailSender notify.EmailSender
	switch {
	case cfg.Email.Configured() && cfg.Env == config.EnvProduction:
		emailSender = &notify.ResendSender{APIKey: cfg.Email.ResendAPIKey, From: cfg.Email.From, ReplyTo: cfg.Email.ReplyTo}
		log.Info("email provider: resend")
	case cfg.Email.Configured():
		allow, err := notify.NewAllowList(cfg.Email.AllowList)
		if err != nil {
			return fmt.Errorf("HG_EMAIL_ALLOWLIST: %w", err)
		}
		emailSender = notify.AllowListSender{
			Next:  &notify.ResendSender{APIKey: cfg.Email.ResendAPIKey, From: cfg.Email.From, ReplyTo: cfg.Email.ReplyTo},
			Allow: allow, Log: log, Capture: captureEmail,
		}
		log.Info("email provider: resend, limited to the non-production allow-list",
			slog.Int("allow_list_entries", allow.Len()))
	default:
		emailSender = notify.LogEmailSender{Log: log, Capture: captureEmail}
		if cfg.Env == config.EnvProduction {
			log.Warn("email provider: log — no email is sent (set HG_RESEND_API_KEY)")
		} else {
			log.Info("email provider: log — emails are written to this log, not sent")
		}
	}
	notifier := notify.NewNotifier().
		Register(notify.ChannelPush, notify.LogSender{Channel: notify.ChannelPush, Log: log}).
		Register(notify.ChannelSMS, notify.LogSender{Channel: notify.ChannelSMS, Log: log}).
		Register(notify.ChannelEmail, notify.EmailAdapter{EmailSender: emailSender})
	notifyClient, err := notify.NewClient(st.DB().Pool, notify.Options{
		Notifier: notifier,
		Accounts: notify.PgAccountLookup{DB: st.DB().Pool},
		Emails: &notify.EmailRenderer{
			Templates: emailTemplates,
			Links:     notify.Links{Restaurant: cfg.Email.RestaurantWebURL, Admin: cfg.Email.AdminWebURL},
		},
		Log: log,
	})
	if err != nil {
		return fmt.Errorf("notify: construct client: %w", err)
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
	// O-03 (SMS provider): HG_SMS_PROVIDER=twilio + credentials is the one-line
	// flip from LogSMSSender (records the send, delivers nothing) to a real
	// Twilio send. Config already refuses to boot with provider=twilio and
	// incomplete credentials (internal/config), so reaching here with
	// provider=="twilio" means Configured() is true.
	var smsSender auth.SMSSender
	if cfg.SMS.Provider == "twilio" {
		t := cfg.SMS.Twilio
		twilio := auth.NewTwilioSMSSender(nil, t.AccountSID, t.AuthToken, t.FromNumber)
		twilio.MessagingServiceSID = t.MessagingServiceSID
		smsSender = twilio
		log.Info("sms provider: twilio")
	} else {
		log.Warn("sms provider: log (O-03 not resolved) — OTP codes are not delivered outside local echo")
	}
	// O-03 / phone-OTP verification provider. HG_OTP_PROVIDER=twilio_verify (with
	// a Verify Service SID + account creds; config refuses to boot otherwise)
	// hands code generation, delivery AND validation to Twilio Verify over
	// WhatsApp or SMS. Unset/"log" keeps the self-hosted challenge path, so dev
	// is unchanged. This is orthogonal to HG_SMS_PROVIDER above.
	var phoneVerifier auth.PhoneVerifier
	var verifyChannel string
	if cfg.OTP.Provider == "twilio_verify" {
		v := cfg.OTP.Verify
		phoneVerifier = auth.NewTwilioVerifyClient(nil, v.AccountSID, v.AuthToken, v.ServiceSID, v.Channel)
		verifyChannel = v.Channel
		log.Info("otp provider: twilio_verify", "channel", v.Channel)
	} else {
		log.Info("otp provider: log (self-hosted challenge)")
	}
	authModule := auth.NewModule(
		st.DB().Pool, st.Cache().Client, authSecrets,
		smsSender, phoneVerifier, verifyChannel, cfg.Env.IsLocal(), string(cfg.Env), log)
	// Email verification, password reset and staff invitations go out
	// through the notification outbox (issue #248).
	authModule.UseNotifications(notifyClient.Enqueue)

	// Behind Traefik with no trusted proxy, every request's client address is
	// Traefik's, so say which mode this process is in.
	if len(cfg.TrustedProxies) == 0 {
		log.Info("trusted proxies: none — X-Forwarded-For is ignored and the socket peer is the client address")
	} else {
		log.Info("trusted proxies: X-Forwarded-For is read from these peers only",
			slog.Any("cidrs", cfg.TrustedProxies))
	}

	router := httpx.NewRouter(httpx.Options{
		Logger:         log,
		Env:            string(cfg.Env),
		CORSOrigins:    cfg.CORSOrigins,
		TrustedProxies: cfg.TrustedProxies,
		Authenticator:  authModule.Authenticator,
		Authorizer:     authModule.Authorizer,
	})

	// getPublicConfig reports the platform-wide pause on new orders, which the
	// orders module owns (https://github.com/shaiknoorullah/hg-mono/issues/244).
	system.Routes(router, system.NewHandler(cfg, st, startedAt, probes).
		WithOrderingStatus(orders.NewStore(st.DB().Pool).OrderingStatus), cfg)
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
	// The media resolver turns stored media objects into direct public URLs on
	// the public-read hg-media bucket (no presigning; KYC/POD stay private). It
	// is shared by catalog (restaurant cards, menu images) and orders (order and
	// cart images), injected via each module's own interface so neither imports
	// the other. PublicBaseURL defaults to the MinIO endpoint for dev.
	mediaResolver := catalog.NewResolver(st.DB().Pool, cfg.MinIO.PublicBaseURL, cfg.MinIO.Buckets.Media)
	catalog.Routes(router, catalog.NewHandler(
		catalogRepo,
		mediaResolver,
		catalog.NewMinIOPresigner(st.Objects()),
		catalog.NewPgScopeResolver(catalogRepo),
	))
	// TODO(siblings): auth.Routes(router, …), orders.Routes(router, …),

	// B5 — cart, quote and orders. The payment gateway is the payments sibling's
	// to provide; until it is wired, orders uses the honest unwired gateway that
	// 503s rather than fabricating a client_secret, and createOrder answers 503.
	//
	// The order-lifecycle notifier. Transition writes the realtime events
	// itself (internal/orders/events.go); this carries only the notifications.
	rtEmitter := &orderRealtimeEmitter{notify: notifyClient.Enqueue}
	// O-01 (HST registration): HG_TAX_HST_REGISTRATION_NUMBER is the one-line
	// flip that stamps the platform's registration number onto every receipt
	// once the accountant confirms the supplier position; empty until then, and
	// the contract renders the field only when configured (never a placeholder).
	ordersStore := orders.NewStore(st.DB().Pool, rtEmitter).
		WithMedia(mediaResolver).
		WithPlatformTaxInfo(cfg.Tax.HSTRegistrationNumber, cfg.Tax.PlatformLegalName)
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
		// The API version every call is made in, never the key.
		log.Info("stripe configured",
			slog.Bool("livemode", cfg.Stripe.LiveMode()),
			slog.String("api_version", payments.StripeAPIVersion),
			slog.Bool("webhook_secret_set", cfg.Stripe.WebhookSecret != ""))
	} else if cfg.Env.IsLocal() {
		// Local dev only: a fake payment client so orders can be placed end-to-end
		// without real Stripe credentials. Never reachable outside local env.
		stripeClient = payments.NewFakeStripe()
		log.Warn("stripe NOT configured — using LOCAL FAKE payment client (dev only, never production)")
	} else {
		log.Warn("stripe not configured — payment mutation routes answer 503 (HG_STRIPE_SECRET_KEY unset)")
	}
	paymentsRepo := payments.NewRepo(st.DB().Pool)
	// A customer whose refund request staff decline is told through the
	// notification outbox, in the decline's own transaction (#172).
	paymentsSvc := payments.NewService(paymentsRepo, stripeClient, cfg.Stripe, log).
		WithOrderHooks(ordersStore).
		WithOutbox(notifyClient.Enqueue)
	// The weekly payout run (issue #251): Monday 09:00 America/Toronto, for
	// every rider and restaurant, and on demand through createPayoutRun. It
	// needs Stripe, so without a client there is no runner and createPayoutRun
	// answers 503. Started with the other background loops below.
	var payoutRunner *payments.PayoutRunner
	if stripeClient != nil {
		host, _ := os.Hostname()
		payoutRunner = payments.NewPayoutRunner(paymentsRepo, stripeClient, payments.PayoutPolicy{
			RestaurantNegativeBlockDays: cfg.Payouts.RestaurantNegativeBalanceBlockDays,
			RestaurantHold:              time.Duration(cfg.Payouts.RestaurantHoldHours) * time.Hour,
		}, host, log)
		paymentsSvc.WithPayoutRunner(payoutRunner)
	}
	payments.Routes(router, payments.NewHandler(paymentsSvc, cfg))
	// The rider who delivered is paid inside the order's DELIVERED transition,
	// under the rider pay rules the owner has not settled (issue #306).
	paymentsSvc.WithRiderPay(cfg.RiderPay)
	ordersStore.WithRiderEarnings(paymentsSvc)
	// A cancelled order releases its rider in the cancel's transaction, on
	// this one store that every caller (admin included) cancels through
	// (https://github.com/shaiknoorullah/hg-mono/issues/415).
	ordersStore.WithOrderCancelled(dispatchCancel{})

	// The webhook worker applies stored Stripe events from the database: one
	// replica at a time under an advisory-lock lease, each event's effect and
	// its processed_at in one transaction, retried with backoff and
	// dead-lettered with an ops alert after eight failures (#231, #249). An
	// authorisation event moves its order through the orders store
	// (orders.Store.PaymentAuthorised) in that same transaction.
	go payments.NewWebhookWorker(paymentsSvc, cfg.Env == config.EnvProduction).Run(ctx)
	// The refund sender sends approved refunds to Stripe: one replica at a
	// time under an advisory-lock lease, each refund claimed and recorded
	// before the call, keyed rf:<refund id>, retried with backoff and set
	// aside with an ops alert after eight failures (#318). The refund
	// webhooks above finalise what it sends. With no Stripe client there is
	// nothing to send to, and approved refunds wait.
	if stripeClient != nil {
		go payments.NewRefundSender(paymentsSvc).Run(ctx)
	}

	// Wire orders to the payments gateway (deferred from B5 above): createOrder
	// now asks the payments sibling to authorise the PaymentIntent (P-16 3/4).
	orderGateway := orderPaymentGateway{svc: paymentsSvc, store: ordersStore, advanceLocal: !cfg.Stripe.Configured() && cfg.Env.IsLocal()}
	orders.Routes(router, orders.NewHandler(ordersStore, orderGateway, log))
	// A ready order nobody collects is escalated on each lapse of its pickup
	// deadline: re-dispatch, an ops alert, a customer notice; at the cap, if
	// no rider holds it, it is cancelled with a full refund (pickup.go).
	deadlineRunner := orders.NewDeadlineRunner(ordersStore, orderGateway, log, cfg.HTTPAddr).
		WithPickupEscalator(&pickupEscalator{notify: notifyClient.Enqueue}).
		WithUncollectedCanceller(uncollectedCanceller{})
	go deadlineRunner.Run(ctx)

	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// orders.Routes(router, …), dispatch.Routes(router, …),
	dispatchStore := dispatch.NewStore(st.DB().Pool)
	dispatchLifecycle := &orderLifecycleAdapter{store: ordersStore}
	dispatchSvc := dispatch.NewService(dispatchStore, dispatchLifecycle)
	dispatch.Routes(router, dispatch.NewHandler(dispatchSvc))
	dispatchRunner := dispatch.NewDispatchRunner(dispatchSvc, log, 3000, 5*time.Second)
	go dispatchRunner.Run(ctx)
	// Rider availability sweeps (issue #255; docs/spec/04-rider.md, "D-10 —
	// Availability: online / offline"): a silent online rider goes ONLINE_STALE,
	// and a rider stuck ON_DELIVERY with no live assignment is restored. Every
	// replica runs them; a lease lets one sweep at a time. riderSweeps.RunOnce is
	// the "sweep now" hook for the dev environment's controls (issue #235).
	riderSweeps := dispatch.NewAvailabilitySweeper(dispatchSvc, log, dispatch.AvailabilitySweepConfig{
		StaleAfter:     cfg.Dispatch.RiderStaleAfter,
		StaleEvery:     cfg.Dispatch.RiderStaleSweepEvery,
		ReconcileEvery: cfg.Dispatch.RiderReconcileEvery,
	})
	go riderSweeps.Run(ctx)

	// B11 — Handoff (internal/handoff, migration 00027): package-seal chain of
	// custody. Reuses the same orderLifecycleAdapter instance dispatch is wired
	// with above — it already satisfies dispatch.OrderLifecycle's three methods
	// plus handoff.OrderLifecycle's OpenDispute — and auth's P-04 Ed25519 signing
	// key, so no second key pair is minted for this module alone.
	handoffStore := handoff.NewStore(st.DB().Pool)
	handoffSvc := handoff.NewService(handoffStore, dispatchLifecycle, authSecrets.SigningPriv, authSecrets.SigningPub, log)
	handoff.Routes(router, handoff.NewHandler(handoffSvc))

	// B7 — Restaurant partner portal (R-01…R-26).
	// Scope resolver reads account_role; ownership enforced in SQL (P-07 / IDOR).
	// restaurantPay bridges restaurant.PaymentActions to the payments sibling so
	// AcceptOrder captures (T6) and RejectOrder voids (T7) without importing the
	// payments package from the restaurant package (modular-monolith seam).
	// Restaurant staff get no invitation email in 1.0: restaurant accounts are
	// owner-only at launch (docs/decisions/README.md, "Staff accounts").
	// Staff invitations are for HalalGoes's own admin staff (issue #170).
	// ordersStore carries the realtime emitter, so accept, reject and
	// mark-ready reach the customer like every other order move
	// (https://github.com/shaiknoorullah/hg-mono/issues/337).
	restaurantRepo := restaurant.NewRepo(st.DB().Pool, ordersStore)
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
	rtGateway := realtime.NewGateway(rtStore, st.Cache().Client, log, nil, cfg.Realtime.MaxSockets)
	rtRelay := realtime.NewRelay(st.DB().Pool, st.Cache().Client, log, nodeID)
	realtime.Routes(router, realtime.NewHandler(rtStore, rtGateway, log, cfg.CORSOrigins))
	go rtGateway.Run(ctx)
	go rtRelay.Run(ctx)

	// Partition maintenance (docs/spec/01-platform.md, "P-39 — Background
	// runtime"): at start-up and hourly, keep realtime_event,
	// rider_position_history and audit_event partitioned ahead of the clock and
	// drop the ones past retention. Every replica runs the loop; a lease lets
	// one work at a time.
	go partitions.New(st.DB().Pool, log).Run(ctx)

	// Retention: the hourly sweep that deletes rows past their retention period
	// from the tables that otherwise only grow — published outbox rows, sockets,
	// sign-in records, dead sessions, old notifications, unused quotes. Every
	// replica runs it; a job_run claim lets one pass run per hour across the
	// fleet. It never deletes ledger, order, audit or KYC rows.
	go retention.New(st.DB().Pool, log).Run(ctx)

	// Payouts: every replica checks each minute for a due payout run; a
	// session advisory lock lets one run at a time, and a run a replica
	// abandons is finished by the next (internal/payments/payout_run.go).
	if payoutRunner != nil {
		go payoutRunner.Run(ctx)
	}

	// Start the notify worker pool now that migrations have run and the process
	// is otherwise ready. Enqueue (used inside order transitions above) works
	// without Start; Start is what drains and delivers queued jobs.
	if err := notifyClient.Start(ctx); err != nil {
		return fmt.Errorf("notify: start worker pool: %w", err)
	}

	// Halal certificate expiry (#252): lapses certificates the day after they
	// expire, delists the restaurant, and sends the 30/14/7/1-day renewal
	// reminders through the notification outbox. One replica works at a time
	// (advisory lock); the other skips. Spec: docs/spec/05-admin.md, "A-17 —
	// Halal certificate expiry monitoring and lapse handling".
	halalExpiry := halalexpiry.New(st.DB().Pool, notifyClient.Enqueue, log, halalexpiry.Config{
		SuspendAfterExpiredDays: cfg.Halal.SuspendAfterExpiredDays,
	})
	go halalExpiry.Run(ctx)

	// TODO(siblings): auth.Routes(router, …), catalog.Routes(router, …),
	// orders.Routes(router, …), dispatch.Routes(router, …),
	// payments.Routes(router, …), files.Routes(router, …), admin.Routes(router, …).

	// B10 — Rider self-service (internal/rider).
	rider.Routes(router, rider.NewHandler(rider.NewService(rider.NewRepo(st.DB().Pool))))

	// B9 — Admin, RBAC & files (internal/admin, internal/files).
	admin.Routes(router, admin.NewHandler(
		// ordersStore carries the notification emitter, so a staff cancel
		// tells the customer like every other transition
		// (https://github.com/shaiknoorullah/hg-mono/issues/352).
		admin.NewRepo(st.DB().Pool).WithNotifications(notifyClient.Enqueue, authModule.StaffInviter()).
			WithOrdersStore(ordersStore),
		admin.DefaultConfig()))
	files.Routes(router, files.NewHandler(files.NewRepo(
		st.DB().Pool,
		// Links are signed for the public host phones reach; server-side
		// reads and deletes stay on the internal client.
		st.Objects().Signer,
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

	// Close the live sockets with 1001 (server going away) first, and wait for
	// the frames to go out, so clients reconnect with backoff instead of seeing
	// an abnormal closure (contracts/websocket.md "Close codes"). It must run
	// before st.Close: each close is recorded in Postgres. http.Server.Shutdown
	// does not track upgraded sockets, so it cannot do this for us.
	rtGateway.Shutdown()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("graceful shutdown exceeded its budget; forcing close",
			slog.String("error", err.Error()))
		_ = srv.Close()
	}
	// Drain in-flight notify jobs within the same shutdown budget.
	if err := notifyClient.Stop(shutdownCtx); err != nil {
		log.Warn("notify worker pool did not stop cleanly", slog.String("error", err.Error()))
	}
	st.Close()
	log.Info("stopped")
	return nil
}

// dispatchCancel implements orders.OrderCancelled with the dispatch module's
// half of a cancellation (dispatch.ReleaseCancelledOrderTx).
type dispatchCancel struct{}

func (dispatchCancel) OrderCancelledTx(ctx context.Context, tx pgx.Tx, orderID string) error {
	return dispatch.ReleaseCancelledOrderTx(ctx, tx, orderID)
}
