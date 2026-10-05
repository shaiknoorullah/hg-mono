package account_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A customer's avatar must be their own confirmed avatar upload. Another
// account's file (say a rider's licence) or the customer's own upload for
// another purpose is 404, and the profile keeps its avatar
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func TestUpdateProfile_AvatarMustBeTheCallersOwnAvatarUpload(t *testing.T) {
	pool := testPool(t)
	f := seedAccountFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	var objects []string
	upload := func(uploader, purpose, bucket string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
			VALUES ($1, 'av/'||md5(random()::text), $2::stored_object_purpose, 'image/jpeg', 2048,
			        decode(repeat('f1',32),'hex'), 'READY', $3, now()) RETURNING id`,
			bucket, purpose, uploader).Scan(&id); err != nil {
			t.Fatalf("seed stored_object: %v", err)
		}
		objects = append(objects, id)
		return id
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `UPDATE customer_profile SET avatar_object_id=NULL WHERE account_id=$1`, f.customerAccountID)
		for _, id := range objects {
			_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE id=$1`, id)
		}
	})
	avatar := func() *string {
		var id *string
		if err := pool.QueryRow(ctx, `SELECT avatar_object_id::text FROM customer_profile WHERE account_id=$1`,
			f.customerAccountID).Scan(&id); err != nil {
			t.Fatalf("read avatar: %v", err)
		}
		return id
	}
	set := func(objectID string) int {
		req := httptest.NewRequest(http.MethodPatch, "/v1/me/profile",
			strings.NewReader(fmt.Sprintf(`{"avatar_object_id":%q}`, objectID)))
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.UpdateCustomerProfile(rec, req)
		return rec.Code
	}

	own := upload(f.customerAccountID, "AVATAR", "hg-tmp")
	if code := set(own); code != http.StatusOK {
		t.Fatalf("own avatar upload: status=%d, want 200", code)
	}
	for name, id := range map[string]string{
		"another account's compliance file": upload(f.riderAccountID, "KYC_DOCUMENT", "hg-kyc"),
		"another account's avatar":          upload(f.otherAccountID, "AVATAR", "hg-tmp"),
		"the caller's own delivery photo":   upload(f.customerAccountID, "POD", "hg-pod"),
	} {
		if code := set(id); code != http.StatusNotFound {
			t.Errorf("%s: status=%d, want 404", name, code)
		}
		if got := avatar(); got == nil || *got != own {
			now := "none"
			if got != nil {
				now = *got
			}
			t.Errorf("%s: avatar is now %s, want it unchanged (%s)", name, now, own)
		}
	}
	if code := set("not-a-uuid"); code != http.StatusUnprocessableEntity {
		t.Errorf("malformed avatar_object_id: status=%d, want 422", code)
	}
}
