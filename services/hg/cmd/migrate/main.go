// Command migrate starts goose, the migration runner, with its connection
// string read from a file.
//
// goose reads its connection string, database password included, from the
// GOOSE_DBSTRING environment variable only, and the migrate image is
// distroless, with no shell to turn a file into a variable. So anything that
// can inspect containers could read the password (issue #309:
// https://github.com/shaiknoorullah/hg-mono/issues/309). This command is the
// image's entrypoint: given GOOSE_DBSTRING_FILE, it reads the file under the
// same rules as the API's secret files (config.ReadSecret), then replaces
// itself with goose, passing the value in goose's own environment. The
// container's configuration, which `docker inspect` shows, then holds only the
// path.
//
// Without GOOSE_DBSTRING_FILE it changes nothing: goose gets the environment
// and the arguments it would have got.
//
// The file must not be readable by its group or everyone unless HG_ENV=local;
// an unset HG_ENV counts as not local.
package main

import (
	"fmt"
	"os"
	"strings"
	"syscall"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// goosePath is where the Dockerfile's migrate stage installs goose. It is a
// variable only so a local smoke run can point it elsewhere with
// -ldflags "-X main.goosePath=...".
var goosePath = "/usr/local/bin/goose"

func main() {
	env, warning, err := gooseEnv(os.Getenv, os.Environ())
	if err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		os.Exit(1)
	}
	if warning != "" {
		fmt.Fprintf(os.Stderr, "migrate: warning: %s\n", warning)
	}
	argv := append([]string{goosePath}, os.Args[1:]...)
	if err := syscall.Exec(goosePath, argv, env); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: cannot start %s: %v\n", goosePath, err)
		os.Exit(1)
	}
}

// gooseEnv returns the environment goose should run with. When
// GOOSE_DBSTRING_FILE is set, the file's value becomes GOOSE_DBSTRING and the
// _FILE variable is dropped; otherwise environ is returned unchanged. Neither
// the warning nor the error contains the connection string.
func gooseEnv(getenv func(string) string, environ []string) ([]string, string, error) {
	strict := strings.TrimSpace(getenv("HG_ENV")) != string(config.EnvLocal)
	dsn, src, warning, err := config.ReadSecret(getenv, "GOOSE_DBSTRING", strict)
	if err != nil {
		return nil, "", err
	}
	if src != config.SecretFromFile {
		return environ, warning, nil
	}
	out := make([]string, 0, len(environ)+1)
	for _, kv := range environ {
		if strings.HasPrefix(kv, "GOOSE_DBSTRING=") || strings.HasPrefix(kv, "GOOSE_DBSTRING_FILE=") {
			continue
		}
		out = append(out, kv)
	}
	return append(out, "GOOSE_DBSTRING="+dsn), warning, nil
}
