package devworld

import (
	"fmt"
	"net"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// AllowReset reports whether a wipe-and-reseed may run. The environment must be
// exactly "local", and the database host must be loopback, a Unix socket, or
// the compose service name "postgres". An empty environment, staging,
// production, and any other host are refused. The fixed sign-in range is a
// separate gate and is not decided here.
func AllowReset(env, dsn string) error {
	if env != "local" {
		return fmt.Errorf("devworld refuses HG_ENV=%q; reset runs only when HG_ENV is local", env)
	}
	cfg, err := pgconn.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("devworld refuses the database address: %w", err)
	}
	if !LocalDBHost(cfg.Host) {
		return fmt.Errorf("devworld refuses database host %q", cfg.Host)
	}
	return nil
}

// LocalDBHost reports whether host is a database this tool is allowed to wipe.
// An empty host is a Unix socket on the local machine.
func LocalDBHost(host string) bool {
	host = strings.TrimSpace(host)
	if strings.HasPrefix(host, "/") {
		return true // Unix-socket directory
	}
	switch strings.ToLower(host) {
	case "", "localhost", "postgres":
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
