package tablets

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

type countingDB struct{ calls int }

func (c *countingDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	c.calls++
	return pgconn.NewCommandTag("UPDATE 0"), nil
}

// The simulated order screens start only in the local dev world with the switch
// on. Every other environment is refused whatever the switch says, so they can
// never keep a real restaurant looking connected.
func TestTabletsRefuseToStartOutsideLocal(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	refused := []struct {
		env string
		on  bool
	}{
		{"production", true},
		{"staging", true},
		{"", true},
		{"prod", true},
		{"dev", true},
		{"Local", true},
		{"local", false},
		{"production", false},
	}
	for _, tc := range refused {
		db := &countingDB{}
		tk, err := New(tc.env, tc.on, db, log)
		if err == nil || tk != nil {
			t.Errorf("env=%q on=%v: started; want refused", tc.env, tc.on)
		}
		if db.calls != 0 {
			t.Errorf("env=%q on=%v: touched the database while refusing", tc.env, tc.on)
		}
	}

	db := &countingDB{}
	tk, err := New("local", true, db, log)
	if err != nil || tk == nil {
		t.Fatalf("local, on: refused: %v", err)
	}
	if tk.every != Every {
		t.Errorf("cadence %s, want %s (the restaurant web app's)", tk.every, Every)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	tk.Run(ctx) // beats once at start, then returns on the cancelled context
	if db.calls != 1 {
		t.Errorf("Run made %d beats before stopping, want 1", db.calls)
	}
}
