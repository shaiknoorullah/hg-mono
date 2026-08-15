package notify

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// Client bundles the pieces most callers need: an Enqueuer to write into
// business transactions, and the underlying River client to Start/Stop the
// worker pool. Construct one with NewClient at boot, alongside store.Open.
type Client struct {
	River   *river.Client[pgx.Tx]
	Enqueue *Enqueuer
	Repo    *Repo
}

// Options configures NewClient. MaxWorkers defaults to 10 when zero.
type Options struct {
	Notifier   *Notifier
	Accounts   AccountLookup // nil is valid: falls back to NoAccountLookup
	Log        *slog.Logger
	MaxWorkers int
}

// NewClient builds the River client, registers DeliveryWorker for
// notify_deliver jobs, and returns everything wired together. It does not
// start the worker pool — call Start for that (typically after migrations
// have run and the process is otherwise ready to serve).
func NewClient(pool *pgxpool.Pool, opts Options) (*Client, error) {
	if opts.Notifier == nil {
		return nil, fmt.Errorf("notify: NewClient: Options.Notifier is required")
	}
	if opts.MaxWorkers <= 0 {
		opts.MaxWorkers = 10
	}
	log := opts.Log
	if log == nil {
		log = slog.Default()
	}

	repo := NewRepo()
	workers := river.NewWorkers()
	river.AddWorker(workers, &DeliveryWorker{
		DB:       pool,
		Repo:     repo,
		Notifier: opts.Notifier,
		Accounts: opts.Accounts,
		Log:      log,
	})

	riverClient, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Logger: log,
		Queues: map[string]river.QueueConfig{
			QueueDefault: {MaxWorkers: opts.MaxWorkers},
		},
		Workers: workers,
	})
	if err != nil {
		return nil, fmt.Errorf("notify: construct river client: %w", err)
	}

	return &Client{
		River:   riverClient,
		Enqueue: NewEnqueuer(repo, riverClient),
		Repo:    repo,
	}, nil
}

// Start begins working jobs. Call once at process boot, after migrations.
func (c *Client) Start(ctx context.Context) error {
	if err := c.River.Start(ctx); err != nil {
		return fmt.Errorf("notify: start river client: %w", err)
	}
	return nil
}

// Stop drains in-flight jobs and stops the worker pool. Safe to call even if
// Start was never called.
func (c *Client) Stop(ctx context.Context) error {
	if err := c.River.Stop(ctx); err != nil {
		return fmt.Errorf("notify: stop river client: %w", err)
	}
	return nil
}
