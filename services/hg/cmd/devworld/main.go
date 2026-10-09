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
	case "scenario":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		if os.Args[2] == "list" {
			devworld.PrintScenarios()
			break
		}
		base := os.Getenv("HG_API_URL")
		if base == "" {
			base = "http://127.0.0.1:8080"
		}
		err = devworld.RunScenario(ctx, base, os.Args[2])
	case "journey":
		var opts devworld.JourneyOptions
		opts, err = devworld.ParseJourneyArgs(os.Args[2:])
		if err != nil {
			usage()
			break
		}
		base := os.Getenv("HG_API_URL")
		if base == "" {
			base = "http://127.0.0.1:8080"
		}
		err = devworld.RunJourney(ctx, base, opts)
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
	fmt.Fprintln(os.Stderr, "usage: devworld reset | seed | verify | list | totp | scenario <name|list> | journey [--route=short|long|early-rider] [--speed=1x|4x|max] [--auto=none|restaurant|all] [--manual=rider]")
	fmt.Fprintln(os.Stderr, "reset and seed require HG_ENV=local and a local HG_POSTGRES_DSN.")
	fmt.Fprintln(os.Stderr, "scenario and journey call HG_API_URL (default http://127.0.0.1:8080). `scenario list` prints every scenario and the state it leaves.")
	fmt.Fprintln(os.Stderr, "scenarios that move a clock (offer-timeout, no-rider, no-rider-cancelled, cert-lapse-mid-order, order-completed, refund-approve) also need HG_ENV=local and a local HG_POSTGRES_DSN, which make dev-scenario sets.")
}
