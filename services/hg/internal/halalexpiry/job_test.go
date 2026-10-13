package halalexpiry_test

// These tests run the expiry job against a real, migrated Postgres, because
// the rules they pin live in the database: the derived halal state, the
// LIVE-never-EXPIRED check, the one-reminder-per-threshold row and the trigger
// that relists on a renewal. Each test run gets its own database, created on
// HG_TEST_POSTGRES_DSN's server or on a throwaway container, because a pass
// evaluates every restaurant it can see.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/halalexpiry"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

var toronto = func() *time.Location {
	loc, err := time.LoadLocation("America/Toronto")
	if err != nil {
		panic(err)
	}
	return loc
}()

// The calendar from 31 days out to the day after expiry: the amber state at
// 30 days, each reminder once, still valid on the last day, expired and
// delisted at local midnight, gone from every customer view, and back on the
// approval of a renewal.
func TestCertificateLapsesWithTheCalendar(t *testing.T) {
	db := newDatabase(t)
	w := seedRestaurant(t, db, 40)
	job := halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{})

	w.runAt(t, job, w.local(-31, 12, 0, 0))
	w.expectListing(t, "CERTIFIED", "LIVE")
	w.expectReminders(t)
	w.expectBadge(t, "CERTIFIED")

	// 30 days out: amber, and the 30-day reminder. A second pass the same day
	// sends nothing more.
	w.runAt(t, job, w.local(-30, 0, 0, 30))
	w.runAt(t, job, w.local(-30, 18, 0, 0))
	w.expectListing(t, "EXPIRING_SOON", "LIVE")
	w.expectReminders(t, 30)

	for _, n := range []int{14, 7, 1} {
		w.runAt(t, job, w.local(-n, 9, 0, 0))
		w.runAt(t, job, w.local(-n, 21, 0, 0))
	}
	w.expectReminders(t, 30, 14, 7, 1)

	// The last day, one second before local midnight: still valid, listed,
	// amber, and no fifth reminder.
	rep := w.runAt(t, job, w.local(0, 23, 59, 59))
	if rep.Expired != 0 || rep.Delisted != 0 || rep.Reminders != 0 {
		t.Fatalf("on the expiry day: %+v, want no change", rep)
	}
	w.expectListing(t, "EXPIRING_SOON", "LIVE")
	w.expectBadge(t, "EXPIRING_SOON")

	// Local midnight after the expiry date: expired and delisted.
	rep = w.runAt(t, job, w.local(1, 0, 0, 30))
	if rep.Expired != 1 || rep.Delisted != 1 {
		t.Fatalf("after expiry: %+v, want one certificate expired and one restaurant delisted", rep)
	}
	w.expectListing(t, "EXPIRED", "DELISTED", "HALAL_CERTIFICATE_EXPIRED")
	w.expectCertificate(t, w.certificate, "EXPIRED")
	w.expectNoBadge(t)
	w.runAt(t, job, w.local(2, 12, 0, 0))
	w.expectReminders(t, 30, 14, 7, 1)

	// Owners and managers hear each reminder and the lapse exactly once;
	// front-of-house staff hear nothing.
	for _, acct := range []uuid.UUID{w.owner, w.manager} {
		w.expectMessages(t, acct, map[string]int{
			fmt.Sprintf("halal_certificate_reminder:%s:30", w.certificate): 1,
			fmt.Sprintf("halal_certificate_reminder:%s:14", w.certificate): 1,
			fmt.Sprintf("halal_certificate_reminder:%s:7", w.certificate):  1,
			fmt.Sprintf("halal_certificate_reminder:%s:1", w.certificate):  1,
			fmt.Sprintf("halal_certificate_expired:%s", w.certificate):     1,
		})
	}
	w.expectMessages(t, w.staff, map[string]int{})

	// Approving a renewal relists in the approval's own transaction.
	renewal := w.approveCertificate(t, 400)
	w.expectListing(t, "CERTIFIED", "LIVE")
	w.expectCertificate(t, renewal, "APPROVED")
	w.expectBadge(t, "CERTIFIED")
}

// Three replicas running the same passes at the same instants have the effect
// of one: one reminder, one lapse message per recipient, one delisting.
func TestEveryReplicaHasTheEffectOfOne(t *testing.T) {
	db := newDatabase(t)
	w := seedRestaurant(t, db, 40)
	jobs := []*halalexpiry.Job{
		halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{}),
		halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{}),
		halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{}),
	}
	together := func(at time.Time) {
		start := make(chan struct{})
		var wg sync.WaitGroup
		for _, j := range jobs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				if rep, _, err := j.RunAt(context.Background(), at); err != nil || len(rep.Errors) > 0 {
					t.Errorf("pass at %s: err=%v, report errors=%v", at, err, rep.Errors)
				}
			}()
		}
		close(start)
		wg.Wait()
		for _, j := range jobs { // and once more each, one after another
			w.runAt(t, j, at)
		}
	}

	// The first pass is 7 days out: the 30- and 14-day notes are stale by then,
	// so only the 7-day reminder goes.
	together(w.local(-7, 12, 0, 0))
	together(w.local(1, 0, 0, 30))

	w.expectReminders(t, 7)
	w.expectListing(t, "EXPIRED", "DELISTED", "HALAL_CERTIFICATE_EXPIRED")
	for _, acct := range []uuid.UUID{w.owner, w.manager} {
		w.expectMessages(t, acct, map[string]int{
			fmt.Sprintf("halal_certificate_reminder:%s:7", w.certificate): 1,
			fmt.Sprintf("halal_certificate_expired:%s", w.certificate):    1,
		})
	}
	var delistings int
	if err := db.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM audit_event
		 WHERE subject_type = 'RESTAURANT' AND subject_id = $1 AND action = 'restaurant.delisted'`,
		w.restaurant).Scan(&delistings); err != nil {
		t.Fatal(err)
	}
	if delistings != 1 {
		t.Fatalf("delisting audit rows = %d, want 1", delistings)
	}
}

// Anything the job cannot vouch for ends without a badge: only the date an
// admin verified counts, an unknown timezone ends a certificate soonest, and a
// missing or past instant, a missing date, an unknown status or an
// off-cadence reminder is refused rather than defaulted.
func TestFailsClosed(t *testing.T) {
	ctx := context.Background()
	db := newDatabase(t)
	job := halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{})
	verified := seedRestaurant(t, db, 40)
	elsewhere := seedRestaurant(t, db, 40)

	t.Run("an unknown timezone takes the latest date anywhere", func(t *testing.T) {
		if _, err := db.pool.Exec(ctx, `UPDATE restaurant SET timezone = 'Mars/Olympus_Mons' WHERE id = $1`,
			elsewhere.restaurant); err != nil {
			t.Fatal(err)
		}
		// Noon in Toronto on the expiry day is already the next day at UTC+14.
		elsewhere.runAt(t, job, elsewhere.local(0, 12, 0, 0))
		elsewhere.expectListing(t, "EXPIRED", "DELISTED", "HALAL_CERTIFICATE_EXPIRED")
		verified.expectListing(t, "EXPIRING_SOON", "LIVE")
	})

	t.Run("a later date the restaurant uploaded does not extend the verified one", func(t *testing.T) {
		// The restaurant uploads a renewal claiming 400 more days; nobody has
		// verified it, so the approved certificate's date still decides.
		claimed := time.Now().In(toronto).AddDate(0, 0, 400).Format(time.DateOnly)
		if _, err := db.pool.Exec(ctx, `
			WITH o AS (
			  INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256,
			                             state, uploaded_by, confirmed_at)
			  VALUES ('hg-kyc', 'test/halal-expiry/claimed.pdf', 'KYC_DOCUMENT', 'application/pdf', 1024,
			          digest('claimed', 'sha256'), 'READY', $2, now()) RETURNING id),
			d AS (
			  INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id,
			                            halal_issuing_body_id, state, valid_until, deadline_at, deadline_action)
			  SELECT 'RESTAURANT', $1, 'HALAL_CERTIFICATE', o.id, $3, 'IN_REVIEW', $4::date,
			         now() + interval '72 hours', 'ESCALATE' FROM o RETURNING id)
			INSERT INTO halal_certificate (restaurant_id, document_id, certificate_number, issuing_body_id,
			    certified_legal_name, certified_address, scope, issued_on, expires_on, status, checklist_version)
			SELECT $1, d.id, 'CLAIMED-1', $3, 'Expiry Test Inc.', '1 Test St, Toronto', 'WHOLE_ESTABLISHMENT',
			       current_date, $4::date, 'PENDING', 1 FROM d`,
			verified.restaurant, verified.owner, verified.body, claimed); err != nil {
			t.Fatal(err)
		}
		verified.runAt(t, job, verified.local(1, 0, 0, 30))
		verified.expectListing(t, "EXPIRED", "DELISTED", "HALAL_CERTIFICATE_EXPIRED")
		verified.expectCertificate(t, verified.certificate, "EXPIRED")
		verified.expectNoBadge(t)
	})

	t.Run("a missing or past instant is refused", func(t *testing.T) {
		if _, ran, err := job.RunAt(ctx, time.Time{}); err == nil || ran {
			t.Fatalf("RunAt(zero) ran=%v err=%v, want a refusal", ran, err)
		}
		rep, _, err := job.RunAt(ctx, time.Now().Add(-48*time.Hour))
		if err != nil || len(rep.Errors) != 2 {
			t.Fatalf("RunAt(two days ago): err=%v, %d restaurant errors, want both refused", err, len(rep.Errors))
		}
		for name, q := range map[string]string{
			"no restaurant":         `SELECT halal_refresh_restaurant_status(NULL::uuid, now())`,
			"no instant":            `SELECT halal_refresh_restaurant_status('` + verified.restaurant.String() + `'::uuid, NULL)`,
			"an instant past":       `SELECT halal_refresh_restaurant_status('` + verified.restaurant.String() + `'::uuid, now() - interval '1 day')`,
			"an unknown restaurant": `SELECT halal_refresh_restaurant_status('` + uuid.NewString() + `'::uuid, now())`,
		} {
			if _, err := db.pool.Exec(ctx, q); err == nil {
				t.Errorf("%s: accepted, want an error", name)
			}
		}
	})

	t.Run("the database refuses a missing date, an unknown status and an off-cadence reminder", func(t *testing.T) {
		for name, c := range map[string]struct{ code, sql string }{
			"no expiry date": {"23502", `
				INSERT INTO halal_certificate (restaurant_id, document_id, certificate_number, issuing_body_id,
				    certified_legal_name, certified_address, scope, issued_on, expires_on, status, checklist_version)
				SELECT restaurant_id, document_id, 'NO-DATE', issuing_body_id, certified_legal_name,
				       certified_address, scope, issued_on, NULL, 'PENDING', checklist_version
				  FROM halal_certificate WHERE id = '` + verified.certificate.String() + `'`},
			"unknown status": {"22P02",
				`UPDATE halal_certificate SET status = 'VALID' WHERE id = '` + verified.certificate.String() + `'`},
			"5-day reminder": {"23514", `
				INSERT INTO halal_certificate_reminder (halal_certificate_id, restaurant_id, days_before, expires_on, sent_on)
				VALUES ('` + verified.certificate.String() + `', '` + verified.restaurant.String() + `', 5,
				        current_date + 5, current_date)`},
		} {
			_, err := db.pool.Exec(ctx, c.sql)
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != c.code {
				t.Errorf("%s: %v, want SQLSTATE %s", name, err, c.code)
			}
		}
	})
}

// Suspension some days after a lapse is an open owner question (#164): off by
// default, and when switched on a renewal does not lift it.
func TestSuspensionAfterLapseWaitsForTheOwner(t *testing.T) {
	db := newDatabase(t)
	w := seedRestaurant(t, db, 40)

	off := halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{})
	on := halalexpiry.New(db.pool, db.outbox, nil, halalexpiry.Config{SuspendAfterExpiredDays: 14})

	// The certificate's first expired day is expiry + 1, so on expiry + 14 it
	// has not yet been expired for 14 whole days.
	w.runAt(t, on, w.local(14, 12, 0, 0))
	w.expectListing(t, "EXPIRED", "DELISTED", "HALAL_CERTIFICATE_EXPIRED")
	w.runAt(t, off, w.local(15, 12, 0, 0))
	w.expectListing(t, "EXPIRED", "DELISTED", "HALAL_CERTIFICATE_EXPIRED")
	if rep := w.runAt(t, on, w.local(15, 12, 0, 0)); rep.Suspended != 1 {
		t.Fatalf("suspended = %d, want 1", rep.Suspended)
	}
	w.expectListing(t, "EXPIRED", "SUSPENDED", "HALAL_CERTIFICATE_EXPIRED")

	w.approveCertificate(t, 400)
	w.expectListing(t, "CERTIFIED", "SUSPENDED")
}

// ---------------------------------------------------------------- the world

type database struct {
	pool   *pgxpool.Pool
	outbox *notify.Enqueuer
}

type world struct {
	db          database
	restaurant  uuid.UUID
	body        uuid.UUID
	owner       uuid.UUID
	manager     uuid.UUID
	staff       uuid.UUID
	certificate uuid.UUID
	expiresOn   time.Time // a date, in Toronto
	lat, lng    float64
}

// local is the instant h:m:s Toronto time, `days` days from the expiry date.
func (w *world) local(days, h, m, s int) time.Time {
	d := w.expiresOn
	return time.Date(d.Year(), d.Month(), d.Day()+days, h, m, s, 0, toronto)
}

func (w *world) runAt(t *testing.T, j *halalexpiry.Job, at time.Time) halalexpiry.Report {
	t.Helper()
	rep, ran, err := j.RunAt(context.Background(), at)
	if err != nil || !ran || len(rep.Errors) > 0 {
		t.Fatalf("pass at %s: ran=%v err=%v errors=%v", at, ran, err, rep.Errors)
	}
	return rep
}

// seedRestaurant makes a LIVE Toronto restaurant with an owner, a manager and
// a front-of-house account, and a certificate that expires `days` days from
// today.
func seedRestaurant(t *testing.T, db database, days int) *world {
	t.Helper()
	ctx := context.Background()
	w := &world{db: db, lat: 43.5 + rand.Float64(), lng: -80 + rand.Float64()}
	account := func() uuid.UUID {
		var id uuid.UUID
		mustScan(t, db.pool.QueryRow(ctx, `INSERT INTO account (email) VALUES ($1) RETURNING id`,
			"halal-expiry-"+uuid.NewString()+"@test.local"), &id)
		return id
	}
	w.owner, w.manager, w.staff = account(), account(), account()
	mustScan(t, db.pool.QueryRow(ctx, `
		INSERT INTO restaurant (slug, legal_name, display_name, province, city, line1, postal_code,
		                        location, onboarding_state, account_state, is_accepting_orders)
		VALUES ($1, 'Expiry Test Inc.', 'Expiry Kitchen', 'ON', 'Toronto', '1 Test St', 'M5J 0C3',
		        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'ACTIVE', 'LIVE', true)
		RETURNING id`, "expiry-"+uuid.NewString()[:8], w.lng, w.lat), &w.restaurant)
	for acct, role := range map[uuid.UUID]string{
		w.owner: "RESTAURANT_OWNER", w.manager: "RESTAURANT_MANAGER", w.staff: "RESTAURANT_STAFF",
	} {
		if _, err := db.pool.Exec(ctx, `
			INSERT INTO account_role (account_id, role, scope_type, scope_id)
			VALUES ($1, $2, 'RESTAURANT', $3)`, acct, role, w.restaurant); err != nil {
			t.Fatal(err)
		}
	}
	mustScan(t, db.pool.QueryRow(ctx, `
		INSERT INTO halal_issuing_body (name, country, status) VALUES ($1, 'CA', 'ACCEPTED') RETURNING id`,
		"Expiry Test Halal Board "+uuid.NewString()), &w.body)

	now := time.Now().In(toronto)
	w.expiresOn = time.Date(now.Year(), now.Month(), now.Day()+days, 0, 0, 0, 0, toronto)
	w.certificate = w.approveCertificate(t, days)
	return w
}

// approveCertificate writes an APPROVED certificate, all seven checks passed,
// expiring `days` days from today, as one transaction (the approval check is
// deferred to commit).
func (w *world) approveCertificate(t *testing.T, days int) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	now := time.Now().In(toronto)
	expires := time.Date(now.Year(), now.Month(), now.Day()+days, 0, 0, 0, 0, time.UTC)
	var cert uuid.UUID
	err := pgx.BeginFunc(ctx, w.db.pool, func(tx pgx.Tx) error {
		var object, doc uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256,
			                           state, uploaded_by, confirmed_at)
			VALUES ('hg-kyc', $1, 'KYC_DOCUMENT', 'application/pdf', 1024, digest($1, 'sha256'),
			        'READY', $2, now()) RETURNING id`,
			"test/halal-expiry/"+uuid.NewString()+".pdf", w.owner).Scan(&object); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id,
			                          halal_issuing_body_id, state, reviewed_by, reviewed_at)
			VALUES ('RESTAURANT', $1, 'HALAL_CERTIFICATE', $2, $3, 'APPROVED', $4, now()) RETURNING id`,
			w.restaurant, object, w.body, w.owner).Scan(&doc); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO halal_certificate (restaurant_id, document_id, certificate_number, issuing_body_id,
			    certified_legal_name, certified_address, scope, issued_on, expires_on, status,
			    checklist_version, verified_by, verified_at)
			VALUES ($1, $2, $3, $4, 'Expiry Test Inc.', '1 Test St, Toronto', 'WHOLE_ESTABLISHMENT',
			        $5::date - 365, $5, 'APPROVED', 1, $6, now()) RETURNING id`,
			w.restaurant, doc, "EXP-"+uuid.NewString()[:8], w.body, expires, w.owner).Scan(&cert); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO halal_certificate_check (halal_certificate_id, check_key, result, computed_result,
			                                     overridable, checked_by, checked_at)
			SELECT $1, k, 'PASS', 'PASS', k NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'), $2, now()
			  FROM unnest(enum_range(NULL::halal_check_key)) AS k`, cert, w.owner)
		return err
	})
	if err != nil {
		t.Fatalf("approve certificate: %v", err)
	}
	return cert
}

// ---------------------------------------------------------------- assertions

func (w *world) expectListing(t *testing.T, halal, account string, reasons ...string) {
	t.Helper()
	var gotHalal, gotAccount string
	var gotReasons []string
	mustScan(t, w.db.pool.QueryRow(context.Background(), `
		SELECT halal_status::text, account_state::text, delist_reasons FROM restaurant WHERE id = $1`,
		w.restaurant), &gotHalal, &gotAccount, &gotReasons)
	if gotHalal != halal || gotAccount != account || !slices.Equal(gotReasons, reasons) {
		t.Fatalf("restaurant is %s/%s %v, want %s/%s %v", gotHalal, gotAccount, gotReasons, halal, account, reasons)
	}
	var stale int
	mustScan(t, w.db.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM halal_status_inconsistency WHERE restaurant_id = $1`, w.restaurant), &stale)
	if stale != 0 {
		t.Fatalf("halal_status_inconsistency lists the restaurant: a badge without a valid certificate")
	}
}

func (w *world) expectCertificate(t *testing.T, id uuid.UUID, status string) {
	t.Helper()
	var got string
	mustScan(t, w.db.pool.QueryRow(context.Background(),
		`SELECT status::text FROM halal_certificate WHERE id = $1`, id), &got)
	if got != status {
		t.Fatalf("certificate %s is %s, want %s", id, got, status)
	}
}

func (w *world) expectReminders(t *testing.T, days ...int) {
	t.Helper()
	rows, err := w.db.pool.Query(context.Background(), `
		SELECT days_before FROM halal_certificate_reminder
		 WHERE halal_certificate_id = $1 ORDER BY days_before DESC`, w.certificate)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got, days) {
		t.Fatalf("reminders recorded %v, want %v", got, days)
	}
}

// expectMessages compares the account's notification rows, by dedupe key.
func (w *world) expectMessages(t *testing.T, account uuid.UUID, want map[string]int) {
	t.Helper()
	rows, err := w.db.pool.Query(context.Background(), `
		SELECT dedupe_key, count(*)::int FROM notification
		 WHERE account_id = $1 AND kind LIKE 'HALAL_CERTIFICATE_%' GROUP BY dedupe_key`, account)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for rows.Next() {
		var key string
		var n int
		if err := rows.Scan(&key, &n); err != nil {
			t.Fatal(err)
		}
		got[key] = n
	}
	if rows.Err() != nil || fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("messages to %s: %v, want %v (%v)", account, got, want, rows.Err())
	}
}

// expectBadge asks the customer API: the restaurant is in the nearby list and
// its detail, carrying this halal badge.
func (w *world) expectBadge(t *testing.T, state string) {
	t.Helper()
	listed := w.customerList(t)
	if len(listed) != 1 || listed[0] != state {
		t.Fatalf("nearby list badges %v, want [%s]", listed, state)
	}
	code, body := w.customerGet(t, "/v1/restaurants/"+w.restaurant.String())
	var detail struct {
		Data struct {
			Halal struct {
				DisplayState string `json:"display_state"`
			} `json:"halal"`
		} `json:"data"`
	}
	if code != http.StatusOK || json.Unmarshal(body, &detail) != nil || detail.Data.Halal.DisplayState != state {
		t.Fatalf("detail: %d %s, want 200 with badge %s", code, body, state)
	}
}

// expectNoBadge asks the customer API: no list, detail or certification view
// carries the restaurant, so no badge of any kind is shown for it.
func (w *world) expectNoBadge(t *testing.T) {
	t.Helper()
	if listed := w.customerList(t); len(listed) != 0 {
		t.Fatalf("nearby list still carries the restaurant with badges %v", listed)
	}
	for _, path := range []string{"", "/certification", "/menu"} {
		if code, body := w.customerGet(t, "/v1/restaurants/"+w.restaurant.String()+path); code != http.StatusNotFound {
			t.Fatalf("GET restaurant%s: %d %s, want 404", path, code, body)
		}
	}
}

// customerList returns the badge of every restaurant within 500 m of this one
// (the smallest radius the list accepts; each test has its own database).
func (w *world) customerList(t *testing.T) []string {
	t.Helper()
	code, body := w.customerGet(t, fmt.Sprintf("/v1/restaurants?latitude=%f&longitude=%f&max_distance_m=500", w.lat, w.lng))
	var list struct {
		Data []struct {
			Halal struct {
				DisplayState string `json:"display_state"`
			} `json:"halal"`
		} `json:"data"`
	}
	if code != http.StatusOK || json.Unmarshal(body, &list) != nil {
		t.Fatalf("list: %d %s", code, body)
	}
	states := []string{}
	for _, c := range list.Data {
		states = append(states, c.Halal.DisplayState)
	}
	return states
}

func (w *world) customerGet(t *testing.T, target string) (int, []byte) {
	t.Helper()
	h := catalog.NewHandler(catalog.NewRepo(w.db.pool), nil, nil, nil)
	r := chi.NewRouter()
	r.Get("/v1/restaurants", h.ListRestaurants)
	r.Get("/v1/restaurants/{restaurantId}", h.GetRestaurant)
	r.Get("/v1/restaurants/{restaurantId}/certification", h.GetRestaurantCertification)
	r.Get("/v1/restaurants/{restaurantId}/menu", h.GetRestaurantMenu)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec.Code, rec.Body.Bytes()
}

func mustScan(t *testing.T, row pgx.Row, dest ...any) {
	t.Helper()
	if err := row.Scan(dest...); err != nil {
		t.Fatal(err)
	}
}

// ---------------------------------------------------------------- the database

var (
	serverOnce sync.Once
	serverDSN  string
	serverErr  error
)

// newDatabase creates and migrates a database for one test, on the server
// HG_TEST_POSTGRES_DSN names or on one container shared by the package, and
// skips when neither is reachable.
func newDatabase(t *testing.T) database {
	t.Helper()
	serverOnce.Do(func() {
		if serverDSN = os.Getenv("HG_TEST_POSTGRES_DSN"); serverDSN != "" {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		var ctr *tcpostgres.PostgresContainer
		ctr, serverErr = tcpostgres.Run(ctx, "postgis/postgis:17-3.5",
			tcpostgres.WithDatabase("hg"), tcpostgres.WithUsername("hg"), tcpostgres.WithPassword("hg"),
			tcpostgres.BasicWaitStrategies())
		if serverErr == nil {
			containers = append(containers, ctr)
			serverDSN, serverErr = ctr.ConnectionString(ctx, "sslmode=disable")
		}
	})
	if serverDSN == "" {
		t.Skipf("no HG_TEST_POSTGRES_DSN and no container runtime: %v", serverErr)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	admin, err := pgx.Connect(ctx, serverDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer admin.Close(ctx)
	name := "hg_halal_expiry_" + uuid.NewString()[:8]
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), serverDSN)
		if err == nil {
			_, _ = c.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
			_ = c.Close(context.Background())
		}
	})

	u, err := url.Parse(serverDSN)
	if err != nil {
		t.Fatalf("parse DSN: %v", err)
	}
	u.Path = "/" + name
	dsn := u.String()
	migrate := exec.CommandContext(ctx, "go", "run", "github.com/pressly/goose/v3/cmd/goose@v3.24.3",
		"-dir", filepath.Join("..", "..", "migrations"), "postgres", dsn, "up")
	if out, err := migrate.CombinedOutput(); err != nil {
		t.Fatalf("goose up: %v\n%s", err, out)
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	// Insert-only River client: the notification row and its delivery job are
	// written; no worker delivers them here.
	rc, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatalf("river client: %v", err)
	}
	return database{pool: pool, outbox: notify.NewEnqueuer(notify.NewRepo(), rc)}
}

var containers []testcontainers.Container

func TestMain(m *testing.M) {
	code := m.Run()
	for _, c := range containers {
		_ = testcontainers.TerminateContainer(c)
	}
	os.Exit(code)
}
