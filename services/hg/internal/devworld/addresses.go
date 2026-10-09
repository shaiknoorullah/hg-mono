package devworld

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
)

// SavedAddress is one address the world SQL gives a customer persona
// (migrations/devworld/001_personas.sql and 020_customer_addresses.sql).
type SavedAddress struct {
	ID      string
	Label   string
	Default bool
	// InRange is true when at least one restaurant customers can order from
	// delivers there, false when none does (the "doesn't deliver to you" gate).
	InRange bool
	// Instructions is true when the unit, buzzer and delivery notes are filled.
	Instructions bool
}

// AddressBooks is each customer persona's expected saved addresses, newest
// first. A persona listed with none is the empty state.
var AddressBooks = map[string][]SavedAddress{
	"amina": {
		{ID: "c0000000-0000-4000-8000-000000000101", Label: "Home", Default: true, InRange: true},
		{ID: "c0000000-0000-4000-8000-000000000102", Label: "Work", InRange: true, Instructions: true},
		{ID: "c0000000-0000-4000-8000-000000000103", Label: "Cottage", InRange: false},
	},
	"nour": {},
}

// verifyAddresses checks each customer persona's address book against
// AddressBooks: the labels in list order (newest first, as GET /v1/addresses
// returns them, so scenarios that take the first one use Home), the default,
// the delivery instructions, and whether any listed restaurant delivers there.
func verifyAddresses(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	var problems []string
	for _, slug := range []string{"amina", "nour"} {
		want := AddressBooks[slug]
		rows, err := conn.Query(ctx, `
			SELECT ad.id::text, COALESCE(ad.label, ''),
			       ad.is_default AND cp.default_address_id = ad.id,
			       ad.unit IS NOT NULL AND ad.buzzer IS NOT NULL AND ad.delivery_notes IS NOT NULL,
			       EXISTS (
			         SELECT 1 FROM restaurant r
			          WHERE r.account_state = 'LIVE' AND r.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')
			            AND r.location IS NOT NULL
			            AND ST_DWithin(r.location, ad.location, r.delivery_radius_m))
			  FROM devworld_persona p
			  JOIN address ad ON ad.account_id = p.account_id AND ad.deleted_at IS NULL
			  LEFT JOIN customer_profile cp ON cp.account_id = p.account_id
			 WHERE p.slug = $1
			 ORDER BY ad.created_at DESC`, slug)
		if err != nil {
			return nil, fmt.Errorf("devworld: address check %s: %w", slug, err)
		}
		var got []SavedAddress
		for rows.Next() {
			var a SavedAddress
			if err := rows.Scan(&a.ID, &a.Label, &a.Default, &a.Instructions, &a.InRange); err != nil {
				rows.Close()
				return nil, fmt.Errorf("devworld: address scan %s: %w", slug, err)
			}
			got = append(got, a)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		var bad []string
		if len(got) != len(want) {
			bad = append(bad, fmt.Sprintf("%d addresses, want %d", len(got), len(want)))
		} else {
			for i, w := range want {
				if got[i] != w {
					bad = append(bad, fmt.Sprintf("address %d is %+v, want %+v", i+1, got[i], w))
				}
			}
		}
		labels := make([]string, 0, len(got))
		for _, a := range got {
			l := a.Label
			if a.Default {
				l += " (default)"
			}
			if !a.InRange {
				l += " (out of range)"
			}
			labels = append(labels, l)
		}
		result := "ok"
		if len(bad) > 0 {
			result = strings.Join(bad, "; ")
			problems = append(problems, slug+" addresses: "+result)
		}
		if len(labels) == 0 {
			labels = append(labels, "none")
		}
		fmt.Fprintf(out, "addresses %-8s %s: %s\n", slug, strings.Join(labels, ", "), result)
	}
	return problems, nil
}
