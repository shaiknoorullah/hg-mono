package files

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// recordingPresigner signs nothing; it counts the download links it was asked for.
type recordingPresigner struct{ gets int }

func (p *recordingPresigner) PresignHeader(context.Context, string, string, string, time.Duration, url.Values, http.Header) (*url.URL, error) {
	return &url.URL{Scheme: "https", Host: "files.test", Path: "/put"}, nil
}

func (p *recordingPresigner) PresignedGetObject(_ context.Context, bucket, object string, _ time.Duration, _ url.Values) (*url.URL, error) {
	p.gets++
	return &url.URL{Scheme: "https", Host: "files.test", Path: "/" + bucket + "/" + object}, nil
}

// A download link is granted for a document only when the requester may see the
// document AND the document's file is its subject's own upload. A restaurant
// document that points at a rider's licence (what the unchecked attach of
// https://github.com/shaiknoorullah/hg-mono/issues/359 could create) yields no
// link to the restaurant; restaurant staff, who cannot list the documents, get
// none either; an admin still can, to reject it.
func TestDownloadURL_OnlyForTheSubjectsOwnFile(t *testing.T) {
	pool := dialTestPool(t)
	ctx := context.Background()

	account := func() string {
		var id string
		if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('dl-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&id); err != nil {
			t.Fatalf("seed account: %v", err)
		}
		return id
	}
	rider, owner, staff, admin := account(), account(), account(), account()

	var restaurantID string
	if err := pool.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name)
VALUES ('dl-'||substr(md5(random()::text),1,8), 'Download Inc.', 'Download Kitchen') RETURNING id`).Scan(&restaurantID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	for acct, role := range map[string]string{owner: "RESTAURANT_OWNER", staff: "RESTAURANT_STAFF"} {
		if _, err := pool.Exec(ctx, `
INSERT INTO account_role (account_id, role, scope_type, scope_id) VALUES ($1, $2, 'RESTAURANT', $3)`,
			acct, role, restaurantID); err != nil {
			t.Fatalf("grant %s: %v", role, err)
		}
	}

	var objects, documents []string
	upload := func(uploader string) string {
		var id string
		if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ('hg-kyc', 'dl/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024,
        decode(repeat('d1',32),'hex'), 'READY', $1, now()) RETURNING id`, uploader).Scan(&id); err != nil {
			t.Fatalf("seed stored_object: %v", err)
		}
		objects = append(objects, id)
		return id
	}
	document := func(objectID string) string {
		var id string
		if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ('RESTAURANT', $1, 'OWNER_ID', $2, 'SUBMITTED', now()+interval '72h', 'ESCALATE') RETURNING id`,
			restaurantID, objectID).Scan(&id); err != nil {
			t.Fatalf("seed kyc_document: %v", err)
		}
		documents = append(documents, id)
		return id
	}
	hijacked := document(upload(rider)) // the rider's licence, attached as the restaurant's
	own := document(upload(owner))

	t.Cleanup(func() {
		c := context.Background()
		for _, id := range documents {
			_, _ = pool.Exec(c, `DELETE FROM kyc_document WHERE id=$1`, id)
		}
		for _, id := range objects {
			_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE id=$1`, id)
		}
		_, _ = pool.Exec(c, `DELETE FROM account_role WHERE scope_id=$1`, restaurantID)
		_, _ = pool.Exec(c, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
		for _, id := range []string{rider, owner, staff, admin} {
			_, _ = pool.Exec(c, `DELETE FROM account WHERE id=$1`, id)
		}
	})

	cases := []struct {
		name       string
		actor      string
		documentID string
		canReadAny bool
		wantURL    bool
	}{
		{"the owner, for the rider's file on their restaurant", owner, hijacked, false, false},
		{"the owner, for their own upload", owner, own, false, true},
		{"restaurant staff, for the owner's upload", staff, own, false, false},
		{"an admin, for the rider's file on the restaurant", admin, hijacked, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := &recordingPresigner{}
			repo := NewRepo(pool, p, nil, Buckets{KYC: "hg-kyc"})
			res, err := repo.DownloadURL(ctx, Actor{AccountID: c.actor, RequestID: "dl-test"}, c.documentID, c.canReadAny)
			if c.wantURL {
				if err != nil || res.URL == "" || p.gets != 1 {
					t.Fatalf("want a link: url=%q err=%v links signed=%d", res.URL, err, p.gets)
				}
				return
			}
			if !errors.Is(err, ErrNotFound) {
				t.Fatalf("err=%v, want ErrNotFound", err)
			}
			if res.URL != "" || p.gets != 0 {
				t.Fatalf("a link was signed: url=%q links signed=%d", res.URL, p.gets)
			}
		})
	}
}
