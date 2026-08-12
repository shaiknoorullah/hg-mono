package store

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// Redis is the disposable client (G-1) plus the address it actually dialled.
//
// Every key written through this client must name its Postgres rebuild source.
// A FLUSHALL in production must cost latency and live fan-out, never
// correctness: no login granted, no rate limit bypassed into a money path, no
// OTP attempt counter reset in a way that grants extra attempts.
type Redis struct {
	Client *redis.Client

	rec *addrRecorder
}

func openRedis(ctx context.Context, cfg config.Redis) (*Redis, error) {
	rec := newAddrRecorder()
	client := redis.NewClient(&redis.Options{
		Addr:            cfg.Addr,
		Password:        cfg.Password,
		DB:              cfg.DB,
		Dialer:          rec.Dial,
		DialTimeout:     5 * time.Second,
		ReadTimeout:     3 * time.Second,
		WriteTimeout:    3 * time.Second,
		PoolSize:        10,
		MinIdleConns:    2,
		ConnMaxIdleTime: 5 * time.Minute,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	return &Redis{Client: client, rec: rec}, nil
}

// RemoteAddr returns the peer address of the last connection the client dialled.
func (r *Redis) RemoteAddr() string {
	if r == nil || r.rec == nil {
		return ""
	}
	return r.rec.get()
}

func (r *Redis) check(ctx context.Context, cfg config.Redis) Dependency {
	d := Dependency{Name: DepRedis, ConfiguredAddress: cfg.Addr}
	if r == nil || r.Client == nil {
		d.Detail = errNotOpen.Error()
		return d
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	start := time.Now()
	err := r.Client.Ping(ctx).Err()
	d.Latency = time.Since(start)
	d.ResolvedAddress = r.RemoteAddr()
	if err != nil {
		d.Detail = err.Error()
		return d
	}
	d.Connected = true
	return d
}

func (r *Redis) close() error {
	if r == nil || r.Client == nil {
		return nil
	}
	return r.Client.Close()
}
