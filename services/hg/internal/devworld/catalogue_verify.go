package devworld

import (
	"context"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"
)

// verifyCatalogue checks that every catalogue restaurant is visible to
// customers the way discovery decides it (LIVE, and CERTIFIED or
// EXPIRING_SOON from the certificate trigger) and has its live menu.
func verifyCatalogue(ctx context.Context, conn *pgx.Conn, out io.Writer) ([]string, error) {
	var problems []string
	visible, items, images := 0, 0, 0
	for _, r := range Catalogue {
		want := 0
		for _, c := range r.Categories {
			want += len(c.Items)
		}
		var account, halal string
		var live, withImage int
		err := conn.QueryRow(ctx, `
			SELECT r.account_state::text, r.halal_status::text,
			       (SELECT count(*) FROM menu_item mi
			          JOIN menu_item_version v ON v.id = mi.live_version_id AND v.review_status = 'APPROVED'
			         WHERE mi.restaurant_id = r.id AND mi.deleted_at IS NULL),
			       (SELECT count(*) FROM menu_item mi
			          JOIN menu_item_version v ON v.id = mi.live_version_id
			          JOIN stored_object so ON so.id = v.image_object_id AND so.state = 'READY'
			         WHERE mi.restaurant_id = r.id)
			  FROM restaurant r WHERE r.id = $1`, r.ID).Scan(&account, &halal, &live, &withImage)
		if err != nil {
			problems = append(problems, fmt.Sprintf("catalogue %s missing (%v)", r.Slug, err))
			continue
		}
		if account != "LIVE" || (halal != "CERTIFIED" && halal != "EXPIRING_SOON") {
			problems = append(problems, fmt.Sprintf("catalogue %s is %s/%s, not visible", r.Slug, account, halal))
		} else {
			visible++
		}
		if live < want {
			problems = append(problems, fmt.Sprintf("catalogue %s live items %d, want %d", r.Slug, live, want))
		}
		items += live
		images += withImage
	}
	fmt.Fprintf(out, "catalogue %d restaurants visible to customers, %d live menu items, %d with a picture\n",
		visible, items, images)
	return problems, nil
}
