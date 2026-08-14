package catalog

import (
	"context"
	"testing"
)

// TestResolverURLForKey pins the pure URL-construction rules: a media-bucket key
// becomes <base>/<bucket>/<key>; a private bucket, an empty key, or an
// unconfigured base all withhold a URL (null), which the contract renders as a
// neutral placeholder rather than a broken or leaking link.
func TestResolverURLForKey(t *testing.T) {
	r := NewResolver(nil, "https://cdn.example.test", "hg-media")

	if got := r.URLForKey("hg-media", "hg-media/menu-item/abc/01_lg.webp"); got == nil ||
		*got != "https://cdn.example.test/hg-media/hg-media/menu-item/abc/01_lg.webp" {
		t.Fatalf("URLForKey(media) = %v, want the joined public URL", got)
	}
	// A private bucket must never be minted into a public URL (P-27 / #7).
	if got := r.URLForKey("hg-kyc", "k/secret.pdf"); got != nil {
		t.Errorf("URLForKey(private bucket) = %v, want nil", *got)
	}
	if got := r.URLForKey("hg-media", ""); got != nil {
		t.Errorf("URLForKey(empty key) = %v, want nil", *got)
	}
	// An unconfigured base renders every URL null — the honest answer when the
	// deployment has not declared where media is served from.
	if got := NewResolver(nil, "", "hg-media").URLForKey("hg-media", "x.webp"); got != nil {
		t.Errorf("URLForKey(no base) = %v, want nil", *got)
	}
}

// TestCardLogoImageURLFromKey proves the card path: a restaurant row carrying a
// media logo (bucket+key, as the stored_object join fetches it) maps through
// toCard to the exact public logo_image_url — the mapper→resolver wiring the
// discovery list and detail both rely on. Pure (no DB), so it never flakes.
func TestCardLogoImageURLFromKey(t *testing.T) {
	res := NewResolver(nil, "http://localhost:9000", "hg-media")
	const key = "hg-media/restaurant/a74bdb39/logo_01.webp"
	bucket := "hg-media"
	okey := key
	rr := restaurantRow{
		id: "a74bdb39-6440-4ffe-a9ba-d6c88a81e15e", slug: "karachi-kitchen",
		displayName: "Karachi Kitchen", halalStatus: HalalCertified,
		logoObjectBucket: &bucket, logoObjectKey: &okey,
	}
	card := toCard(rr, buildAvailabilityInfo(rr, openStateVerdict{state: OpenStateOpen}, false), res)
	if card.LogoImageURL == nil {
		t.Fatalf("card.LogoImageURL = nil, want the joined public URL")
	}
	if want := "http://localhost:9000/hg-media/" + key; *card.LogoImageURL != want {
		t.Errorf("card.LogoImageURL = %q, want %q", *card.LogoImageURL, want)
	}
	// With no media key the card renders a null image, never a bundled photo.
	bare := toCard(restaurantRow{id: "x", halalStatus: HalalCertified},
		buildAvailabilityInfo(restaurantRow{}, openStateVerdict{state: OpenStateOpen}, false), res)
	if bare.LogoImageURL != nil {
		t.Errorf("card.LogoImageURL (no key) = %v, want nil", *bare.LogoImageURL)
	}
}

// TestResolverPublicURLReadsStoredObject exercises the single-item DB path end to
// end: a READY hg-media object resolves to <base>/hg-media/<key>; a private-bucket
// object and a not-READY object both resolve to nil; and a card built from a
// visible restaurant pointed at the media object carries that URL. It needs a
// migrated database (HG_TEST_POSTGRES_DSN); otherwise it skips.
func TestResolverPublicURLReadsStoredObject(t *testing.T) {
	pool := requirePool(t)
	ctx := context.Background()
	rp := NewRepo(pool)
	res := NewResolver(pool, "http://localhost:9000", "hg-media")

	// An account to own the uploads (uploaded_by is NOT NULL).
	var acctID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO account (email, status)
		VALUES ('media-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
		RETURNING id`).Scan(&acctID); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	// A READY media object with a known key.
	mediaKey := "hg-media/restaurant/" + substr8() + "/logo_01.webp"
	var mediaID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
		VALUES ('hg-media', $2, 'MENU_IMAGE', 'image/webp', 2048, decode(repeat('a1',32),'hex'), 'READY', $1, now())
		RETURNING id`, acctID, mediaKey).Scan(&mediaID); err != nil {
		t.Fatalf("seed media stored_object: %v", err)
	}
	// A private (hg-kyc) READY object — must never resolve to a public URL.
	var kycID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
		VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024, decode(repeat('a1',32),'hex'), 'READY', $1, now())
		RETURNING id`, acctID).Scan(&kycID); err != nil {
		t.Fatalf("seed kyc stored_object: %v", err)
	}
	// A PENDING media object — not READY, so it must not resolve either. PENDING
	// requires a deadline (stored_object_deadline_required CHECK).
	var pendingID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, deadline_at, deadline_action)
		VALUES ('hg-media', 'hg-media/pending/'||md5(random()::text), 'MENU_IMAGE', 'image/webp', 1, decode(repeat('a1',32),'hex'), 'PENDING', $1, now()+interval '1h', 'DELETE')
		RETURNING id`, acctID).Scan(&pendingID); err != nil {
		t.Fatalf("seed pending stored_object: %v", err)
	}

	// A LIVE restaurant pointed at the media logo, forced visible for the read.
	var restID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO restaurant (
			slug, legal_name, display_name, province, city, line1, postal_code,
			location, onboarding_state, account_state, is_accepting_orders,
			commission_rate_bps, tax_role, minimum_order_cents, logo_object_id
		) VALUES (
			'media-'||substr(md5(random()::text),1,8), 'Media Test Co', 'Media Kitchen', 'ON', 'Toronto', '1 King St', 'M5J0C3',
			ST_SetSRID(ST_MakePoint(-79.3810, 43.6412), 4326)::geography,
			'ACTIVE', 'LIVE', true, 0, 'RESTAURANT_IS_SUPPLIER', 0, $1
		) RETURNING id`, mediaID).Scan(&restID); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	// halal_status is trigger-derived from the certificate chain (I-34.1); for a
	// read-only visibility fixture we set it directly — no trigger fires on a
	// restaurant UPDATE, so this sticks and is confined to the test row.
	if _, err := pool.Exec(ctx, `UPDATE restaurant SET halal_status='CERTIFIED' WHERE id=$1`, restID); err != nil {
		t.Fatalf("force visible: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM restaurant WHERE id=$1`, restID)
		_, _ = pool.Exec(ctx, `DELETE FROM stored_object WHERE id = ANY($1)`, []string{mediaID, kycID, pendingID})
		_, _ = pool.Exec(ctx, `DELETE FROM account WHERE id=$1`, acctID)
	})

	wantURL := "http://localhost:9000/hg-media/" + mediaKey

	// 1) PublicURL resolves the READY media object.
	if got := res.PublicURL(ctx, mediaID); got == nil || *got != wantURL {
		t.Errorf("PublicURL(media) = %v, want %q", got, wantURL)
	}
	// 2) A private object never resolves to a public URL.
	if got := res.PublicURL(ctx, kycID); got != nil {
		t.Errorf("PublicURL(private) = %v, want nil", *got)
	}
	// 3) A not-READY object never resolves.
	if got := res.PublicURL(ctx, pendingID); got != nil {
		t.Errorf("PublicURL(pending) = %v, want nil", *got)
	}

	// 4) The card path: getVisible joins stored_object → object_key, and toCard
	//    builds logo_image_url from it.
	rr, err := rp.getVisible(ctx, restID, nil, nil)
	if err != nil {
		t.Fatalf("getVisible: %v", err)
	}
	if rr.logoObjectKey == nil || *rr.logoObjectKey != mediaKey {
		t.Fatalf("getVisible logoObjectKey = %v, want %q", rr.logoObjectKey, mediaKey)
	}
	card := toCard(rr, buildAvailabilityInfo(rr, openStateVerdict{state: OpenStateOpen}, false), res)
	if card.LogoImageURL == nil || *card.LogoImageURL != wantURL {
		t.Errorf("card.LogoImageURL = %v, want %q", card.LogoImageURL, wantURL)
	}
}

// substr8 returns 8 hex chars for a unique object key path segment.
func substr8() string {
	const hex = "0123456789abcdef"
	b := make([]byte, 8)
	for i := range b {
		b[i] = hex[(i*7+3)%16]
	}
	return string(b)
}
