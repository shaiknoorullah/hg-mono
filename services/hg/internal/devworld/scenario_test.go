package devworld

import (
	"context"
	"strings"
	"testing"
)

func TestRunScenarioRejectsUnknownName(t *testing.T) {
	err := RunScenario(context.Background(), "http://127.0.0.1:1", "not-a-scenario")
	if err == nil || !strings.Contains(err.Error(), "unknown scenario") {
		t.Fatalf("got %v", err)
	}
}

func TestRunScenarioRequiresBaseURL(t *testing.T) {
	err := RunScenario(context.Background(), "  ", "new-order")
	if err == nil || !strings.Contains(err.Error(), "base URL") {
		t.Fatalf("got %v", err)
	}
}
