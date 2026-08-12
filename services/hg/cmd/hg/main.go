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
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/auth"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/system"
)

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
	// The revocation deny set refreshes from Postgres every 10 s (P-04).
	authModule.StartRevocationRefresher(ctx)
	// TODO(siblings): catalog.Routes(router, …), orders.Routes(router, …),
	// dispatch.Routes(router, …), payments.Routes(router, …),
	// realtime.Routes(router, …), files.Routes(router, …), admin.Routes(router, …).

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
