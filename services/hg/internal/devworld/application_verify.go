package devworld

import (
	"context"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"
)

// verifyApplications checks the restaurants the application scenarios left
// (none after a reset). One waiting in DOCUMENTS_REVIEW has a pending halal
// certificate; checks recorded on it mean a person has started the review in
// the console, which is reported, not refused. One in DOCUMENTS_REJECTED has a
// recorded rejection with a reason and no certified halal state.
func verifyApplications(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	rows, err := conn.Query(ctx, `
		SELECT r.display_name, r.onboarding_state::text, r.halal_status::text,
		       COALESCE(ra.decision::text, ''), COALESCE(ra.reject_reason_code::text, ''),
		       COALESCE(hc.status::text, ''),
		       (SELECT count(*) FROM halal_certificate_check k
		         WHERE k.halal_certificate_id = hc.id AND (k.result <> 'NOT_ASSESSED' OR k.checked_at IS NOT NULL))
		  FROM restaurant r
		  LEFT JOIN restaurant_application ra ON ra.restaurant_id = r.id
		  LEFT JOIN LATERAL (
		        SELECT id, status FROM halal_certificate
		         WHERE restaurant_id = r.id ORDER BY created_at DESC LIMIT 1) hc ON true
		 WHERE r.display_name LIKE $1 || '%'
		   AND r.onboarding_state IN ('DOCUMENTS_REVIEW', 'DOCUMENTS_REJECTED')
		 ORDER BY r.created_at`, applicationNamePrefix)
	if err != nil {
		return nil, fmt.Errorf("devworld: application query: %w", err)
	}
	defer rows.Close()
	var problems []string
	inReview, started, rejected := 0, 0, 0
	for rows.Next() {
		var name, state, halal, decision, reason, certStatus string
		var checked int
		if err := rows.Scan(&name, &state, &halal, &decision, &reason, &certStatus, &checked); err != nil {
			return nil, fmt.Errorf("devworld: application scan: %w", err)
		}
		switch state {
		case "DOCUMENTS_REVIEW":
			inReview++
			if checked > 0 {
				started++
			}
			if certStatus != "PENDING" {
				problems = append(problems, fmt.Sprintf("%s in review: halal certificate %q, want PENDING", name, certStatus))
			}
		case "DOCUMENTS_REJECTED":
			rejected++
			if decision != "REJECT" || reason == "" {
				problems = append(problems, fmt.Sprintf("%s rejected: decision %q reason %q", name, decision, reason))
			}
			if halal == "CERTIFIED" || halal == "EXPIRING_SOON" {
				problems = append(problems, fmt.Sprintf("%s rejected but halal %s", name, halal))
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	fmt.Fprintf(out, "application scenarios: %d in review (%d with checks started), %d rejected\n", inReview, started, rejected)
	return problems, nil
}
