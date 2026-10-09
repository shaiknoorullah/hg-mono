package devworld

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
)

// verifyLedger reads the whole ledger and reports any batch or order whose
// entries do not sum to zero: every order's money decomposes to zero
// residual (AGENTS.md "Non-negotiable invariants"). After a reset the ledger
// is empty; after the money scenarios it holds their batches, and it must
// still balance. It also prints the refunds amina is left with, the state the
// refund-decisions scenario leaves. It only reads.
func verifyLedger(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	var problems []string
	var batches, entries, orders int
	if err := conn.QueryRow(ctx, `
		SELECT count(DISTINCT b.id), count(e.id), count(DISTINCT b.order_id)
		  FROM ledger_batch b LEFT JOIN ledger_entry e ON e.batch_id = b.id`).Scan(&batches, &entries, &orders); err != nil {
		return nil, fmt.Errorf("devworld: ledger count: %w", err)
	}
	rows, err := conn.Query(ctx, `
		SELECT 'batch ' || b.id::text, sum(e.amount_cents)::bigint
		  FROM ledger_batch b JOIN ledger_entry e ON e.batch_id = b.id
		 GROUP BY b.id HAVING sum(e.amount_cents) <> 0
		UNION ALL
		SELECT 'order ' || o.code, sum(e.amount_cents)::bigint
		  FROM ledger_batch b
		  JOIN ledger_entry e ON e.batch_id = b.id
		  JOIN "order" o ON o.id = b.order_id
		 GROUP BY o.code HAVING sum(e.amount_cents) <> 0`)
	if err != nil {
		return nil, fmt.Errorf("devworld: ledger balance: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var what string
		var sum int64
		if err := rows.Scan(&what, &sum); err != nil {
			return nil, err
		}
		problems = append(problems, fmt.Sprintf("ledger %s sums to %d", what, sum))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := "every batch and order sums to 0"
	if len(problems) > 0 {
		result = strings.Join(problems, ", ")
	}
	fmt.Fprintf(out, "ledger %d batches, %d entries, %d orders: %s\n", batches, entries, orders, result)

	refundRows, err := conn.Query(ctx, `
		SELECT r.state::text, count(*)
		  FROM refund r
		  JOIN "order" o ON o.id = r.order_id
		  JOIN devworld_persona p ON p.account_id = o.account_id
		 WHERE p.slug = 'amina'
		 GROUP BY r.state ORDER BY r.state`)
	if err != nil {
		return nil, fmt.Errorf("devworld: refunds: %w", err)
	}
	defer refundRows.Close()
	var states []string
	for refundRows.Next() {
		var state string
		var n int
		if err := refundRows.Scan(&state, &n); err != nil {
			return nil, err
		}
		states = append(states, fmt.Sprintf("%s %d", state, n))
	}
	if err := refundRows.Err(); err != nil {
		return nil, err
	}
	if len(states) == 0 {
		states = []string{"none"}
	}
	fmt.Fprintf(out, "amina refunds: %s\n", strings.Join(states, ", "))
	return problems, nil
}
