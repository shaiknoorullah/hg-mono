package devworld

import (
	"context"
	"strings"
	"testing"
)

func TestParseJourneyArgsDefaults(t *testing.T) {
	opts, err := ParseJourneyArgs(nil)
	if err != nil {
		t.Fatal(err)
	}
	if opts.Route != "short" || opts.Speed != "1x" || opts.Auto != "none" || opts.ManualRider {
		t.Fatalf("%+v", opts)
	}
}

func TestParseJourneyArgsFlags(t *testing.T) {
	opts, err := ParseJourneyArgs([]string{"--route=early-rider", "--speed=max", "--auto=all", "--manual=rider"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.Route != "early-rider" || opts.Speed != "max" || opts.Auto != "all" || !opts.ManualRider {
		t.Fatalf("%+v", opts)
	}
}

func TestParseJourneyArgsRejectsUnknown(t *testing.T) {
	for _, args := range [][]string{
		{"--route=downtown"},
		{"--speed=2x"},
		{"--auto=rider"},
		{"--manual=customer"},
		{"--extra"},
	} {
		if _, err := ParseJourneyArgs(args); err == nil {
			t.Fatalf("accepted %v", args)
		}
	}
}

func TestRunJourneyRequiresBaseURL(t *testing.T) {
	err := RunJourney(context.Background(), "  ", JourneyOptions{Route: "short", Speed: "1x", Auto: "none"})
	if err == nil || !strings.Contains(err.Error(), "base URL") {
		t.Fatalf("got %v", err)
	}
}
