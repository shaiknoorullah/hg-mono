package store

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Dependency names, matching the contract's ReadinessStatus.dependencies enum.
const (
	DepPostgres = "postgres"
	DepRedis    = "redis"
	DepMinIO    = "minio"
	DepStripe   = "stripe"
)

// Boot-probe names, matching the contract's DependencyReport.boot_probes enum.
const (
	ProbeBucketPrivacy = "bucket_privacy"
	ProbePostGIS       = "postgis"
	ProbeStripeLive    = "stripe_livemode"
)

// Dependency is one line of the config-reality report.
//
// ConfiguredAddress and ResolvedAddress are separate fields on purpose. They
// answer different questions, and the whole value of this report is in the case
// where they disagree.
type Dependency struct {
	Name string
	// ConfiguredAddress is the string the environment supplied.
	ConfiguredAddress string
	// ResolvedAddress is the peer of the socket actually opened. Empty when
	// nothing has connected yet.
	ResolvedAddress string
	// Connected is a live check performed now, not a cached flag.
	Connected bool
	// Latency is the round trip of that live check.
	Latency time.Duration
	// Detail carries the failure reason when Connected is false.
	Detail string
}

// Probe is one boot-time self-check result (G-7).
type Probe struct {
	Name   string
	Passed bool
	Detail string
}

// Report is the whole config-reality picture at a moment in time.
type Report struct {
	Environment  string
	Dependencies []Dependency
	Probes       []Probe
}

// Ready reports whether every dependency answered.
func (r Report) Ready() bool {
	for _, d := range r.Dependencies {
		if !d.Connected {
			return false
		}
	}
	return true
}

// Store holds the live clients. It is constructed once at boot and shared.
type Store struct {
	cfg *config.Config
	log *slog.Logger

	pg    *Postgres
	redis *Redis
	minio *MinIO

	closeOnce sync.Once
}

// Open dials every dependency and returns a Store only if all of them answered.
//
// This is G-7's first half: a process that cannot reach its dependencies must
// not come up reporting healthy. Partial construction is not a state this type
// can be in — on any failure the already-opened clients are closed and the error
// names the dependency and the address it tried.
func Open(ctx context.Context, cfg *config.Config, log *slog.Logger) (*Store, error) {
	s := &Store{cfg: cfg, log: log}

	pg, err := openPostgres(ctx, cfg.Postgres)
	if err != nil {
		return nil, fmt.Errorf("postgres (configured %s): %w", cfg.Postgres.Host(), err)
	}
	s.pg = pg

	rdb, err := openRedis(ctx, cfg.Redis)
	if err != nil {
		s.Close()
		return nil, fmt.Errorf("redis (configured %s): %w", cfg.Redis.Addr, err)
	}
	s.redis = rdb

	mc, err := openMinIO(ctx, cfg.MinIO)
	if err != nil {
		s.Close()
		return nil, fmt.Errorf("minio (configured %s): %w", cfg.MinIO.Endpoint, err)
	}
	s.minio = mc

	return s, nil
}

// DB returns the Postgres pool. Repositories take this; they never open a pool.
func (s *Store) DB() *Postgres { return s.pg }

// Cache returns the Redis client. Remember G-1: anything stored here must be
// rebuildable from Postgres.
func (s *Store) Cache() *Redis { return s.redis }

// Objects returns the MinIO client.
func (s *Store) Objects() *MinIO { return s.minio }

// Check performs a live probe of every dependency and returns the report behind
// /health/ready, /internal/deps and /debug/deps.
//
// Each dependency is probed concurrently and independently: one slow dependency
// must not hide the state of the others, which is the readiness answer Traefik
// needs to pull a replica out of rotation.
func (s *Store) Check(ctx context.Context) Report {
	rep := Report{Environment: string(s.cfg.Env)}

	deps := make([]Dependency, 3)
	var wg sync.WaitGroup
	wg.Add(3)

	go func() { defer wg.Done(); deps[0] = s.pg.check(ctx, s.cfg.Postgres) }()
	go func() { defer wg.Done(); deps[1] = s.redis.check(ctx, s.cfg.Redis) }()
	go func() { defer wg.Done(); deps[2] = s.minio.check(ctx, s.cfg.MinIO) }()
	wg.Wait()

	rep.Dependencies = deps
	// TODO(payments sibling): append the "stripe" dependency here. The contract
	// enumerates it in both ReadinessStatus and DependencyReport, and omitting a
	// dependency we do not yet hold is more honest than reporting it ready.
	return rep
}

// BootProbes runs the G-7 startup self-probes and returns their results.
//
// The caller decides what a failure means. In production a failed private-bucket
// probe must be fatal — P-27 is explicit that a world-readable KYC bucket is the
// failure that leaked restaurant licences and halal certificates, and the probe
// exists to make it unbootable. Locally, where buckets may not be created yet,
// a failure is reported and logged rather than fatal.
func (s *Store) BootProbes(ctx context.Context) []Probe {
	probes := []Probe{s.pg.probePostGIS(ctx)}
	probes = append(probes, s.minio.probeBucketPrivacy(ctx, s.cfg.MinIO)...)
	// TODO(payments sibling): the stripe_livemode probe — assert the configured
	// key's livemode matches HG_ENV, so a test key can never reach production
	// and a live key can never reach staging.
	return probes
}

// FatalProbeError returns a non-nil error when a probe failure must stop the
// boot for this environment.
func (s *Store) FatalProbeError(probes []Probe) error {
	if s.cfg.Env.IsLocal() {
		return nil
	}
	var failed []string
	for _, p := range probes {
		if !p.Passed {
			failed = append(failed, fmt.Sprintf("%s: %s", p.Name, p.Detail))
		}
	}
	if len(failed) == 0 {
		return nil
	}
	return fmt.Errorf("G-7 boot probe failure in env %q: %v", s.cfg.Env, failed)
}

// Close releases every client. It is safe to call more than once.
func (s *Store) Close() {
	s.closeOnce.Do(func() {
		if s.pg != nil {
			s.pg.close()
		}
		if s.redis != nil {
			if err := s.redis.close(); err != nil {
				s.log.Warn("redis close failed", slog.String("error", err.Error()))
			}
		}
	})
}

// errNotOpen is returned by a check against a client that was never opened.
var errNotOpen = errors.New("client not open")
