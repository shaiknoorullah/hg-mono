package devworld

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
)

// printPersonaOrders writes how many orders amina has in each state, so the
// state a scenario leaves can be read back: payment-failed leaves a FAILED
// order and payment-unpaid an active CREATED one. A reset leaves none. It
// reports; it does not fail verify, since any number of scenarios may have
// run since the reset. It only reads.
func printPersonaOrders(ctx context.Context, conn *pgx.Conn, out io.Writer) error {
	rows, err := conn.Query(ctx, `
		SELECT o.state::text, count(*)
		  FROM "order" o
		  JOIN devworld_persona p ON p.account_id = o.account_id
		 WHERE p.slug = 'amina'
		 GROUP BY o.state ORDER BY o.state`)
	if err != nil {
		return fmt.Errorf("devworld: amina orders: %w", err)
	}
	defer rows.Close()
	var states []string
	for rows.Next() {
		var state string
		var n int
		if err := rows.Scan(&state, &n); err != nil {
			return err
		}
		states = append(states, fmt.Sprintf("%s %d", state, n))
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(states) == 0 {
		states = []string{"none"}
	}
	fmt.Fprintf(out, "amina orders: %s\n", strings.Join(states, ", "))
	return nil
}
