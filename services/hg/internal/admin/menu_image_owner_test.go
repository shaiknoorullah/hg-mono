package admin

import (
	"context"
	"errors"
	"testing"
)

// An admin creating a menu item on a restaurant's behalf may give it a photo
// the admin uploaded, or one the restaurant uploaded. Another account's upload,
// or a file uploaded for another purpose, is refused and no item is written
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func TestCreateMenuItemOnBehalf_ImageMustBeTheAdminsOrTheRestaurants(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool)
	sa := seedSuperAdmin(t, ctx, pool)
	data := seedMenuRestaurantFull(t, ctx, pool, sa)
	actor := auditActor{staffID: sa, roles: []string{"SUPER_ADMIN"}, requestID: "req-menu-image"}

	var stranger, owner string
	for _, id := range []*string{&stranger, &owner} {
		if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('mi-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(id); err != nil {
			t.Fatalf("seed account: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, 'RESTAURANT_OWNER', 'RESTAURANT', $2)`,
		owner, data.restaurantID); err != nil {
		t.Fatalf("grant owner: %v", err)
	}
	var objects []string
	upload := func(uploader, purpose, bucket string) string {
		var id string
		if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ($1, 'mi/'||md5(random()::text), $2::stored_object_purpose, 'image/jpeg', 2048,
        decode(repeat('e1',32),'hex'), 'READY', $3, now()) RETURNING id`, bucket, purpose, uploader).Scan(&id); err != nil {
			t.Fatalf("seed stored_object: %v", err)
		}
		objects = append(objects, id)
		return id
	}
	t.Cleanup(func() {
		c := context.Background()
		for _, id := range objects {
			_, _ = pool.Exec(c, `UPDATE menu_item SET live_version_id=NULL
			                      WHERE live_version_id IN (SELECT id FROM menu_item_version WHERE image_object_id=$1)`, id)
			_, _ = pool.Exec(c, `DELETE FROM menu_item_version WHERE image_object_id=$1`, id)
			_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE id=$1`, id)
		}
		_, _ = pool.Exec(c, `DELETE FROM account_role WHERE account_id IN ($1,$2)`, stranger, owner)
		_, _ = pool.Exec(c, `DELETE FROM account WHERE id IN ($1,$2)`, stranger, owner)
	})

	create := func(imageID string) error {
		_, err := repo.CreateMenuItemOnBehalf(ctx, actor, menuItemCreate{
			restaurantID:  data.restaurantID,
			categoryID:    data.categoryID,
			priceCents:    1500,
			name:          "Photo Test",
			dietaryTags:   []string{},
			allergenTags:  []string{},
			imageObjectID: &imageID,
			taxCategory:   "PREPARED_FOOD",
		})
		return err
	}
	versionsWith := func(imageID string) int {
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM menu_item_version WHERE image_object_id=$1`, imageID).Scan(&n)
		return n
	}

	for name, id := range map[string]string{
		"another account's menu photo":    upload(stranger, "MENU_IMAGE", "hg-media"),
		"the admin's own compliance file": upload(sa, "KYC_DOCUMENT", "hg-kyc"),
	} {
		if err := create(id); !errors.Is(err, ErrUploadNotFound) {
			t.Errorf("%s: err=%v, want ErrUploadNotFound", name, err)
		}
		if n := versionsWith(id); n != 0 {
			t.Errorf("%s: %d menu versions carry it, want 0", name, n)
		}
	}
	for name, id := range map[string]string{
		"the admin's own menu photo":  upload(sa, "MENU_IMAGE", "hg-media"),
		"the restaurant's menu photo": upload(owner, "MENU_IMAGE", "hg-media"),
	} {
		if err := create(id); err != nil {
			t.Errorf("%s: err=%v, want the item created", name, err)
		}
	}
}
