package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/payments"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/realtime"
)

// stripeCatchupUsage is printed for -h and for a bad invocation.
const stripeCatchupUsage = `usage: hg stripe-catchup --since <time>

Replays the Stripe events created since <time> through the webhook path, then
reads back from Stripe every payment intent written in the last 24 hours and
corrects its state. Run it after a database failover or a restore from backup,
before the API replicas resume. Every step is idempotent: running it twice
changes nothing the second time.

<time> is RFC 3339 (2026-10-01T03:00:00Z) or a duration back from now (90m,
6h). Stripe keeps events for 30 days.

Each disagreement with Stripe it will not settle by itself is filed as a
reconciliation_exception and listed on every run until a person resolves it
(sets its resolved_at). Every stored event in the window is applied through
the same handlers as the server's webhook worker, including one the worker
set aside after repeated failures: running this is how such an event is
retried once its cause is fixed.

It needs the server's own environment (HG_POSTGRES_DSN, HG_STRIPE_SECRET_KEY,
HG_ENV and the rest), which is what keeps it admin-only: there is no HTTP route
to it. Exits non-zero when anything failed or needs a person.
`

// runStripeCatchup is the `hg stripe-catchup` subcommand: the on-demand Stripe
// catch-up from docs/spec/01-platform.md, "P-17 — Webhooks, idempotency and
// reconciliation". The work is payments.Service.CatchUp; this only wires it.
func runStripeCatchup(args []string, stdout io.Writer) error {
	fs := flag.NewFlagSet("stripe-catchup", flag.ContinueOnError)
	fs.Usage = func() { fmt.Fprint(fs.Output(), stripeCatchupUsage) }
	sinceArg := fs.String("since", "", "replay Stripe events created at or after this time")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("stripe-catchup: unexpected argument %q\n\n%s", fs.Arg(0), stripeCatchupUsage)
	}
	since, err := parseSince(*sinceArg, time.Now())
	if err != nil {
		return fmt.Errorf("stripe-catchup: %w\n\n%s", err, stripeCatchupUsage)
	}

	cfg, err := config.LoadFromOS()
	if err != nil {
		return err
	}
	// The fake client invents payment states, so there is nothing real to
	// catch up from without a key.
	if !cfg.Stripe.Configured() {
		return errors.New("stripe-catchup: HG_STRIPE_SECRET_KEY is not set, so there is no Stripe account to catch up from")
	}
	// Same rule as the webhook handler: an event's livemode must match the
	// environment, so a test key never replays into production or back.
	envIsLive := cfg.Env == config.EnvProduction
	if cfg.Stripe.LiveMode() != envIsLive {
		return fmt.Errorf("stripe-catchup: the Stripe key's mode (live=%t) does not match HG_ENV=%s",
			cfg.Stripe.LiveMode(), cfg.Env)
	}

	log := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel})).
		With(slog.String("service", "hg-stripe-catchup"), slog.String("env", string(cfg.Env)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	poolCfg, err := pgxpool.ParseConfig(cfg.Postgres.DSN)
	if err != nil {
		return fmt.Errorf("stripe-catchup: postgres: %w", err)
	}
	poolCfg.MaxConns = 2
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return fmt.Errorf("stripe-catchup: postgres: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("stripe-catchup: postgres unreachable: %w", err)
	}

	stripe := payments.NewLiveStripe(cfg.Stripe.SecretKey, cfg.Stripe.WebhookSecret)
	// Events move orders here as they do in the server's webhook worker: an
	// order whose authorisation event was lost is presented to the restaurant
	// now. Its realtime event is written; its push notification is not, as
	// this command runs without the notification client.
	ordersStore := orders.NewStore(pool, &orderRealtimeEmitter{store: realtime.NewStore(pool, "stripe-catchup")})
	svc := payments.NewService(payments.NewRepo(pool), stripe, cfg.Stripe, log).
		WithOrderHooks(ordersStore)
	rep, err := svc.CatchUp(ctx, since, envIsLive)
	printCatchUpReport(stdout, rep)
	if err != nil {
		return fmt.Errorf("stripe-catchup: %w", err)
	}
	if rep.LeftWork() {
		return fmt.Errorf("stripe-catchup: %d failure(s) and %d open mismatch(es) need a person; "+
			"re-running is safe, and a mismatch stays listed until its reconciliation_exception is resolved",
			len(rep.Failures), len(rep.Mismatches))
	}
	return nil
}

// parseSince reads --since as an RFC 3339 time or as a duration back from now.
func parseSince(v string, now time.Time) (time.Time, error) {
	if v == "" {
		return time.Time{}, errors.New("--since is required")
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return t, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return time.Time{}, fmt.Errorf("--since %q is neither an RFC 3339 time nor a positive duration", v)
	}
	return now.Add(-d), nil
}

func printCatchUpReport(w io.Writer, rep payments.CatchUpReport) {
	fmt.Fprintf(w, "Stripe catch-up\n")
	fmt.Fprintf(w, "  events since %s: %d listed, %d new to this database, %d applied\n",
		rep.Since.UTC().Format(time.RFC3339), rep.EventsListed, rep.EventsNew, rep.EventsProcessed)
	fmt.Fprintf(w, "  payment intents written since %s: %d checked against Stripe\n",
		rep.ReconciledFrom.UTC().Format(time.RFC3339), rep.IntentsChecked)
	section := func(title string, lines []string) {
		fmt.Fprintf(w, "%s: %d\n", title, len(lines))
		for _, l := range lines {
			fmt.Fprintf(w, "  %s\n", l)
		}
	}
	section("Transitions applied", rep.Transitions)
	section("Mismatches for a person", rep.Mismatches)
	section("Failures", rep.Failures)
}
