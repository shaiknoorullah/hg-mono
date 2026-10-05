// Command devworld resets a local database to a known set of personas.
// It refuses every environment other than local, and every database that is
// not on this machine.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/devworld"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	env := os.Getenv("HG_ENV")
	dsn := os.Getenv("HG_POSTGRES_DSN")
	var err error
	switch os.Args[1] {
	case "reset":
		err = devworld.Reset(ctx, env, dsn)
	case "seed":
		err = devworld.Seed(ctx, env, dsn)
	case "verify":
		if err = devworld.AllowReset(env, dsn); err != nil {
			break
		}
		err = devworld.Verify(ctx, dsn)
	case "list":
		devworld.PrintManifest()
	case "totp":
		err = devworld.PrintAdminCode(time.Now())
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: devworld reset | seed | verify | list | totp")
	fmt.Fprintln(os.Stderr, "reset and seed require HG_ENV=local and a local HG_POSTGRES_DSN.")
}
