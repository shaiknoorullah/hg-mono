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
// also writes bismillah-grill's unpaid balance and payouts (payout-run). It
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

	// What the payout-run scenario reads: bismillah-grill's unpaid balance
	// in the ledger, and the payouts made from it.
	var unpaid int64
	var payouts int
	if err := conn.QueryRow(ctx, `
		SELECT COALESCE((SELECT sum(amount_cents) FROM ledger_entry
		                  WHERE account = 'RESTAURANT_PAYABLE' AND counterparty_type = 'RESTAURANT'
		                    AND counterparty_id = $1 AND payout_id IS NULL), 0)::bigint,
		       (SELECT count(*) FROM payout p JOIN connect_account ca ON ca.id = p.connect_account_id
		         WHERE ca.owner_type = 'RESTAURANT' AND ca.owner_id = $1)`,
		BismillahRestaurantID).Scan(&unpaid, &payouts); err != nil {
		return fmt.Errorf("devworld: bismillah payouts: %w", err)
	}
	fmt.Fprintf(out, "bismillah-grill unpaid balance %d cents, payouts %d\n", unpaid, payouts)
	return nil
}
