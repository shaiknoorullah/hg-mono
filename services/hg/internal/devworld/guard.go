package devworld

import (
	"fmt"
	"net"
	"net/url"
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

// AllowAPI reports whether a scenario may create accounts and rows through the
// API at baseURL. The host must be loopback or a compose service name ("api",
// "traefik"); anything else is refused before the first request, so a
// mistyped HG_API_URL never leaves a junk account on a shared server.
func AllowAPI(baseURL string) error {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || u.Host == "" {
		return fmt.Errorf("devworld refuses API address %q; it must be an http URL on this machine", baseURL)
	}
	if !LocalAPIHost(u.Hostname()) {
		return fmt.Errorf("devworld refuses API host %q; onboarding scenarios run only against this machine (localhost, 127.0.0.1, ::1, api, traefik)", u.Hostname())
	}
	return nil
}

// LocalAPIHost reports whether host is an API this tool may write through.
func LocalAPIHost(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "localhost", "api", "traefik":
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
