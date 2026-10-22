package devworld

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
)

// RedesignCustomers are the customer personas of migrations/devworld/040_redesign_personas.sql
// and the account status each starts in. Sign-in refuses the two that are not
// ACTIVE; customer-flagged is the account the account-state scenarios act on.
var RedesignCustomers = []struct{ Slug, Status string }{
	{"customer-suspended", "SUSPENDED"},
	{"customer-banned", "BANNED"},
	{"customer-flagged", "ACTIVE"},
}

// verifyRedesign checks what the redesign personas promise beyond the persona
// table: the customers' account status, no account on the reserved first-run
// phone, the rider-payout payout account, and each state restaurant in its
// state (listed and certified, and closed by its hours, out of range of every
// address amina has, with an empty menu, or with a certificate file missing).
func verifyRedesign(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	var problems []string

	for _, c := range RedesignCustomers {
		who, err := identity(c.Slug)
		if err != nil {
			return nil, err
		}
		var status string
		if err := conn.QueryRow(ctx, `SELECT status::text FROM account WHERE id = $1`, who.AccountID).Scan(&status); err != nil {
			problems = append(problems, c.Slug+": account missing")
			continue
		}
		result := "ok"
		if status != c.Status {
			result = "status " + status + ", want " + c.Status
			problems = append(problems, c.Slug+": "+result)
		}
		fmt.Fprintf(out, "customer %-19s %-10s %s\n", c.Slug, c.Status, result)
	}

	var accounts int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM account WHERE phone_e164 = $1`, UnregisteredPhone).Scan(&accounts); err != nil {
		return nil, fmt.Errorf("devworld: unregistered phone check: %w", err)
	}
	result := "ok"
	if accounts != 0 {
		// A sign-in with the number creates the account; make dev-reset removes it.
		result = fmt.Sprintf("%d account(s) (a sign-in created it; make dev-reset removes it)", accounts)
		problems = append(problems, "first-run phone "+UnregisteredPhone+": "+result)
	}
	fmt.Fprintf(out, "first-run phone %s has no account: %s\n", UnregisteredPhone, result)

	payout, err := identity("rider-payout")
	if err != nil {
		return nil, err
	}
	var ready int
	if err := conn.QueryRow(ctx, `
		SELECT count(*) FROM connect_account
		 WHERE owner_type = 'RIDER' AND owner_id = $1 AND payouts_enabled`, payout.AccountID).Scan(&ready); err != nil {
		return nil, fmt.Errorf("devworld: rider-payout payout account: %w", err)
	}
	if ready != 1 {
		problems = append(problems, "rider-payout: no ready payout account")
	}

	amina, err := identity("amina")
	if err != nil {
		return nil, err
	}
	for _, r := range StateRestaurants {
		var account, halal string
		var hours, items, near int
		var fileKey string
		err := conn.QueryRow(ctx, `
			SELECT r.account_state::text, r.halal_status::text,
			       (SELECT count(*) FROM restaurant_hours h WHERE h.restaurant_id = r.id),
			       (SELECT count(*) FROM menu_item mi
			          JOIN menu_item_version v ON v.id = mi.live_version_id AND v.review_status = 'APPROVED'
			         WHERE mi.restaurant_id = r.id AND mi.deleted_at IS NULL),
			       (SELECT count(*) FROM address ad
			         WHERE ad.account_id = $2 AND ad.deleted_at IS NULL
			           AND ST_DWithin(r.location, ad.location, r.delivery_radius_m)),
			       COALESCE((SELECT so.object_key FROM halal_certificate c
			                   JOIN kyc_document d ON d.id = c.document_id
			                   JOIN stored_object so ON so.id = d.stored_object_id
			                  WHERE c.restaurant_id = r.id LIMIT 1), '')
			  FROM restaurant r WHERE r.id = $1`, r.ID, amina.AccountID).Scan(&account, &halal, &hours, &items, &near, &fileKey)
		if err != nil {
			problems = append(problems, fmt.Sprintf("state restaurant %s missing (%v)", r.Slug, err))
			continue
		}
		var bad []string
		if account != "LIVE" || (halal != "CERTIFIED" && halal != "EXPIRING_SOON") {
			bad = append(bad, fmt.Sprintf("%s/%s, not listed", account, halal))
		}
		if (r.Hours == hoursNone) != (hours == 0) {
			bad = append(bad, fmt.Sprintf("%d weekly hour rows", hours))
		}
		want := 0
		for _, c := range r.Categories {
			want += len(c.Items)
		}
		if items != want {
			bad = append(bad, fmt.Sprintf("live items %d, want %d", items, want))
		}
		if r.Slug == "rouge-valley-roti" && near != 0 {
			bad = append(bad, fmt.Sprintf("in range of %d of amina's addresses, want none", near))
		}
		if r.Slug != "rouge-valley-roti" && near == 0 {
			bad = append(bad, "out of range of every address amina has")
		}
		if !strings.HasPrefix(fileKey, certKeyPrefix(r)) {
			bad = append(bad, "certificate key "+fileKey+", want it under "+certKeyPrefix(r))
		}
		result := "ok"
		if len(bad) > 0 {
			result = fmt.Sprint(bad)
			problems = append(problems, "state restaurant "+r.Slug+": "+result)
		}
		fmt.Fprintf(out, "state restaurant %-22s hours %d, items %d, in range of %d of amina's addresses: %s\n",
			r.Slug, hours, items, near, result)
	}
	return problems, nil
}
