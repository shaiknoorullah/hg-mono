package devworld

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
)

// RestaurantStaffPersona is a seeded member of bismillah-grill's own staff
// (migrations/devworld/030_restaurant_staff.sql). Manager and staff sign in
// with the shared password; the invited one has no password yet and the
// suspended one's account cannot sign in.
type RestaurantStaffPersona struct {
	Slug          string
	Email         string
	Role          string // RESTAURANT_MANAGER or RESTAURANT_STAFF, scoped to bismillah-grill
	Status        string // restaurant_staff_profile.status
	AccountStatus string
}

// BismillahStaff is bismillah-grill's roster after a reset, oldest first.
var BismillahStaff = []RestaurantStaffPersona{
	{Slug: "bismillah-manager", Email: "bismillah-manager@seed.hg", Role: "RESTAURANT_MANAGER", Status: "ACTIVE", AccountStatus: "ACTIVE"},
	{Slug: "bismillah-staff", Email: "bismillah-staff@seed.hg", Role: "RESTAURANT_STAFF", Status: "ACTIVE", AccountStatus: "ACTIVE"},
	{Slug: "bismillah-invited", Email: "bismillah-invited@seed.hg", Role: "RESTAURANT_STAFF", Status: "INVITED", AccountStatus: "ACTIVE"},
	{Slug: "bismillah-suspended", Email: "bismillah-suspended@seed.hg", Role: "RESTAURANT_STAFF", Status: "SUSPENDED", AccountStatus: "SUSPENDED"},
}

// verifyRestaurantStaff checks bismillah-grill's staff roster and its two
// upcoming hours overrides: opening late, then closed all day four days later,
// both after today in Toronto.
func verifyRestaurantStaff(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	var problems []string
	for _, s := range BismillahStaff {
		var role, status, accountStatus string
		err := conn.QueryRow(ctx, `
			SELECT COALESCE((SELECT r.role::text FROM account_role r
			                  WHERE r.account_id = a.id AND r.scope_type = 'RESTAURANT'
			                    AND r.scope_id = $2 AND r.revoked_at IS NULL
			                  ORDER BY r.role LIMIT 1), ''),
			       COALESCE(sp.status::text, ''),
			       a.status::text
			  FROM account a
			  LEFT JOIN restaurant_staff_profile sp ON sp.account_id = a.id
			 WHERE a.email = $1`, s.Email, BismillahRestaurantID).Scan(&role, &status, &accountStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			problems = append(problems, s.Slug+": staff account missing")
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("devworld: restaurant staff check %s: %w", s.Slug, err)
		}
		var bad []string
		if role != s.Role {
			bad = append(bad, "role "+dash(&role))
		}
		if status != s.Status {
			bad = append(bad, "staff status "+dash(&status))
		}
		if accountStatus != s.AccountStatus {
			bad = append(bad, "account "+accountStatus)
		}
		result := "ok"
		if len(bad) > 0 {
			result = strings.Join(bad, ", ")
			problems = append(problems, s.Slug+": "+result)
		}
		fmt.Fprintf(out, "bismillah staff %-20s %-18s %-9s %s\n", s.Slug, s.Role, s.Status, result)
	}

	var late, closed, gap int
	if err := conn.QueryRow(ctx, `
		WITH o AS (
		  SELECT on_date, is_closed FROM restaurant_hours_override
		   WHERE restaurant_id = $1 AND on_date > halal_local_date('America/Toronto', now())
		)
		SELECT count(*) FILTER (WHERE NOT is_closed),
		       count(*) FILTER (WHERE is_closed),
		       COALESCE(max(on_date) FILTER (WHERE is_closed) - min(on_date) FILTER (WHERE NOT is_closed), 0)
		  FROM o`, BismillahRestaurantID).Scan(&late, &closed, &gap); err != nil {
		return nil, fmt.Errorf("devworld: hours overrides: %w", err)
	}
	result := "ok"
	if late != 1 || closed != 1 || gap != 4 {
		result = fmt.Sprintf("late openings %d, closed days %d, days apart %d; want 1, 1, 4", late, closed, gap)
		problems = append(problems, "bismillah hours overrides: "+result)
	}
	fmt.Fprintf(out, "bismillah hours overrides upcoming: opening late %d, closed all day %d: %s\n", late, closed, result)
	return problems, nil
}
