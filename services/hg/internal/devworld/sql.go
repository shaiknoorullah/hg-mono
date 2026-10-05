package devworld

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func migrationsRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	start := dir
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "migrations", "devworld", "001_personas.sql")
		if _, err := os.Stat(candidate); err == nil {
			return filepath.Join(dir, "migrations"), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("devworld: could not locate migrations/devworld/001_personas.sql from %s", start)
}

// ApplyPersonas loads the persona SQL. The file is idempotent and wraps itself
// in one transaction. It is not applied by goose.
func ApplyPersonas(ctx context.Context, dsn string) error {
	root, err := migrationsRoot()
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(filepath.Join(root, "devworld", "001_personas.sql"))
	if err != nil {
		return fmt.Errorf("devworld: read personas: %w", err)
	}
	script := strings.TrimSpace(string(raw))
	if script == "" {
		return fmt.Errorf("devworld: persona SQL is empty")
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	if _, err := conn.PgConn().Exec(ctx, script).ReadAll(); err != nil {
		return fmt.Errorf("devworld: persona SQL failed: %w", err)
	}
	return nil
}

func connect(ctx context.Context, dsn string) (*pgx.Conn, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("devworld: database connection failed: %s", redactDSN(dsn, err))
	}
	return conn, nil
}

func redactDSN(dsn string, err error) string {
	msg := err.Error()
	cfg, perr := pgconn.ParseConfig(dsn)
	if perr == nil && cfg.Password != "" {
		msg = strings.ReplaceAll(msg, cfg.Password, "redacted")
	}
	return msg
}
