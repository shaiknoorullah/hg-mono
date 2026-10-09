package devworld

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/pquerna/otp/totp"
)

// Verify compares the live database with the persona table and writes a table
// to stdout. It returns an error when any persona is missing or different.
func Verify(ctx context.Context, dsn string) error {
	return verifyTo(ctx, dsn, os.Stdout)
}

func verifyTo(ctx context.Context, dsn string, out io.Writer) error {
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT p.slug,
		       COALESCE(p.email::text, ''),
		       COALESCE(p.phone_e164, ''),
		       p.expect_email_verified,
		       p.expect_password,
		       p.expect_onboarding,
		       p.expect_account_state,
		       p.expect_halal,
		       p.expect_accepting,
		       p.expect_rider_onboarding,
		       p.expect_rider_availability,
		       p.expect_rider_status,
		       a.id IS NOT NULL,
		       COALESCE(a.email_verified_at IS NOT NULL, false),
		       COALESCE(a.password_hash IS NOT NULL, false),
		       a.password_hash,
		       r.onboarding_state::text,
		       r.account_state::text,
		       r.halal_status::text,
		       r.is_accepting_orders,
		       rp.onboarding_state::text,
		       rp.availability_state::text,
		       rp.account_status::text
		  FROM devworld_persona p
		  LEFT JOIN account a ON a.id = p.account_id
		  LEFT JOIN restaurant r ON r.id = p.restaurant_id
		  LEFT JOIN rider_profile rp ON rp.account_id = p.account_id
		 ORDER BY p.slug`)
	if err != nil {
		return fmt.Errorf("devworld: verify query failed (persona table missing?): %w", err)
	}
	defer rows.Close()

	fmt.Fprintf(out, "%-18s %-16s %-12s %-14s %-9s %s\n",
		"slug", "onboarding", "account", "halal", "accepting", "result")
	var seen int
	var problems []string
	var adminHash string
	for rows.Next() {
		var (
			slug, email, phone                           string
			expectEmail                                  *bool
			expectPassword                               bool
			expectOnboarding, expectAccount, expectHalal *string
			expectAccepting                              *bool
			expectRiderOn, expectRiderAv, expectRiderSt  *string
			accountExists, emailVerified, hasPassword    bool
			passwordHash                                 *string
			onboarding, accountState, halal              *string
			accepting                                    *bool
			riderOn, riderAv, riderSt                    *string
		)
		if err := rows.Scan(
			&slug, &email, &phone,
			&expectEmail, &expectPassword,
			&expectOnboarding, &expectAccount, &expectHalal, &expectAccepting,
			&expectRiderOn, &expectRiderAv, &expectRiderSt,
			&accountExists, &emailVerified, &hasPassword, &passwordHash,
			&onboarding, &accountState, &halal, &accepting,
			&riderOn, &riderAv, &riderSt,
		); err != nil {
			return fmt.Errorf("devworld: verify scan: %w", err)
		}
		seen++
		var bad []string
		if !accountExists {
			bad = append(bad, "account missing")
		}
		if expectEmail != nil && *expectEmail != emailVerified {
			bad = append(bad, fmt.Sprintf("email verified %v", emailVerified))
		}
		if expectPassword != hasPassword {
			bad = append(bad, fmt.Sprintf("password present %v", hasPassword))
		}
		bad = append(bad, diffPtr("onboarding", expectOnboarding, onboarding)...)
		bad = append(bad, diffPtr("account", expectAccount, accountState)...)
		bad = append(bad, diffPtr("halal", expectHalal, halal)...)
		if expectAccepting != nil && (accepting == nil || *expectAccepting != *accepting) {
			bad = append(bad, "accepting")
		}
		bad = append(bad, diffPtr("rider onboarding", expectRiderOn, riderOn)...)
		bad = append(bad, diffPtr("rider availability", expectRiderAv, riderAv)...)
		bad = append(bad, diffPtr("rider status", expectRiderSt, riderSt)...)
		if slug == "admin-seed" && passwordHash != nil {
			adminHash = *passwordHash
		}
		result := "ok"
		if len(bad) > 0 {
			result = strings.Join(bad, ", ")
			problems = append(problems, slug+": "+result)
		}
		fmt.Fprintf(out, "%-18s %-16s %-12s %-14s %-9s %s\n",
			slug, dash(onboarding), dash(accountState), dash(halal), dashBool(accepting), result)
		_ = email
		_ = phone
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if seen == 0 {
		return fmt.Errorf("devworld: persona table is empty")
	}
	if seen != len(World) {
		problems = append(problems, fmt.Sprintf("persona count %d, manifest %d", seen, len(World)))
	}

	var items, hours int
	if err := conn.QueryRow(ctx, `
		SELECT count(*)
		  FROM menu_item mi
		  JOIN menu_item_version v ON v.id = mi.live_version_id
		 WHERE mi.restaurant_id = $1
		   AND v.review_status = 'APPROVED'`, BismillahRestaurantID).Scan(&items); err != nil {
		return fmt.Errorf("devworld: menu count: %w", err)
	}
	if err := conn.QueryRow(ctx, `
		SELECT count(*) FROM restaurant_hours WHERE restaurant_id = $1`, BismillahRestaurantID).Scan(&hours); err != nil {
		return fmt.Errorf("devworld: hours count: %w", err)
	}
	if items < 2 {
		problems = append(problems, fmt.Sprintf("bismillah live menu items %d", items))
	}
	if hours != 7 {
		problems = append(problems, fmt.Sprintf("bismillah hours %d", hours))
	}
	fmt.Fprintf(out, "bismillah live menu items %d, hours %d\n", items, hours)

	var connects int
	if err := conn.QueryRow(ctx, `
		SELECT count(*) FROM connect_account
		 WHERE stripe_account_id LIKE 'acct_test_devworld_%'`).Scan(&connects); err != nil {
		return fmt.Errorf("devworld: connect count: %w", err)
	}
	fmt.Fprintf(out, "connect stand-ins %d (not real payout accounts)\n", connects)

	catProblems, err := verifyCatalogue(ctx, conn, out)
	if err != nil {
		return err
	}
	problems = append(problems, catProblems...)

	rstaffProblems, err := verifyRestaurantStaff(ctx, conn, out)
	if err != nil {
		return err
	}
	problems = append(problems, rstaffProblems...)

	if adminHash == "" {
		problems = append(problems, "admin password hash missing")
	} else if ok, err := PasswordMatches(ctx, adminHash); err != nil {
		return fmt.Errorf("devworld: password check: %w", err)
	} else if !ok {
		problems = append(problems, "admin password does not match the local persona password")
	} else {
		fmt.Fprintln(out, "admin password matches the local persona password")
	}

	if len(problems) > 0 {
		return fmt.Errorf("devworld: verify failed: %s", strings.Join(problems, "; "))
	}
	fmt.Fprintf(out, "personas %d ok\n", seen)
	return nil
}

func diffPtr(name string, want, got *string) []string {
	if want == nil {
		return nil
	}
	if got == nil || *want != *got {
		have := "null"
		if got != nil {
			have = *got
		}
		return []string{fmt.Sprintf("%s %s", name, have)}
	}
	return nil
}

func dash(v *string) string {
	if v == nil || *v == "" {
		return "-"
	}
	return *v
}

func dashBool(v *bool) string {
	if v == nil {
		return "-"
	}
	if *v {
		return "true"
	}
	return "false"
}

// PrintManifest writes the stable persona ids. It does not print the password.
func PrintManifest() {
	fmt.Printf("%-18s %-28s %s\n", "slug", "email", "phone")
	for _, id := range World {
		fmt.Printf("%-18s %-28s %s\n", id.Slug, id.Email, id.Phone)
	}
}

// PrintAdminCode writes the current authenticator code for the local admin.
// The derived secret itself is not printed.
func PrintAdminCode(now time.Time) error {
	secret, err := AdminTOTPSecret(AdminEmail)
	if err != nil {
		return err
	}
	code, err := totp.GenerateCode(secret, now)
	if err != nil {
		return fmt.Errorf("devworld: totp code: %w", err)
	}
	left := 30 - int(now.Unix()%30)
	fmt.Printf("email %s\ncode %s\nseconds %d\n", AdminEmail, code, left)
	return nil
}
