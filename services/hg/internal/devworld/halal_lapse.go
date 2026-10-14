package devworld

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/halalexpiry"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// Halal certificate lapse and renewal (issue #685), without waiting a day.
//
// halal-lapse runs the expiry job itself (halalexpiry.RunAt) once, as of an
// instant LapseAhead from now. It writes no halal row by hand: the job moves
// the certificate to EXPIRED, delists the restaurant and queues the owner's
// notice, as it would after a real midnight. The job refuses any instant in
// the past, so nothing here can revive a lapse.
//
// halal-renew is the way back, through the API only: the owner uploads and
// attaches a new certificate, admin-seed transcribes it, records the checks
// and approves it, and the approval relists the restaurant.

const (
	restaurantExpiring = "b0000000-0000-4000-8000-000000000209"
	// The expiring persona's certificate expires tomorrow (Toronto's date,
	// migrations/devworld/001_personas.sql), so two days ahead is past its last
	// valid day at any hour.
	LapseAhead = 48 * time.Hour
)

func scenarioHalalLapse(ctx context.Context, base string) error {
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if err := lapseGuard(base, os.Getenv("HG_ENV"), dsn); err != nil {
		return err
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("devworld: database connection failed: %s", redactDSN(dsn, err))
	}
	defer pool.Close()

	// Insert-only: the running API's workers deliver what the job queues.
	inserter, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		return fmt.Errorf("devworld: notification outbox: %w", err)
	}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	job := halalexpiry.New(pool, notify.NewEnqueuer(notify.NewRepo(), inserter), quiet, halalexpiry.Config{})
	at := time.Now().Add(LapseAhead)
	rep, ran, err := job.RunAt(ctx, at)
	if err != nil {
		return fmt.Errorf("devworld: halal expiry pass: %w", err)
	}
	if !ran {
		return errors.New("devworld: another halal expiry pass holds the lock; run the scenario again in a few seconds")
	}
	fmt.Printf("expiry pass as of %s  evaluated %d  expired %d  delisted %d  reminders %d\n",
		at.Format(time.RFC3339), rep.Evaluated, rep.Expired, rep.Delisted, rep.Reminders)
	for _, e := range rep.Errors {
		fmt.Printf("expiry pass  %s\n", e.Error())
	}

	account, halal, err := restaurantHalalState(ctx, pool, restaurantExpiring)
	if err != nil {
		return err
	}
	fmt.Printf("expiring-halal  account %s  halal %s\n", account, halal)
	if halal == "CERTIFIED" {
		return errors.New("devworld: expiring-halal holds a renewed certificate (s=halal-renew); run `make dev-reset` to seed the expiring one again")
	}
	if account != "DELISTED" || halal != "EXPIRED" {
		return fmt.Errorf("devworld: halal-lapse left expiring-halal %s and %s, want DELISTED and EXPIRED; if the persona was seeded before midnight UTC on a Toronto evening, its dates count from UTC until https://github.com/shaiknoorullah/hg-mono/pull/654 lands: run `make dev-reset` and try again", account, halal)
	}
	return lapseSeenThroughAPI(ctx, base)
}

// lapseGuard refuses anything but a local environment, database and API,
// before the first connection.
func lapseGuard(base, env, dsn string) error {
	if err := AllowAPI(base); err != nil {
		return err
	}
	if err := AllowReset(env, dsn); err != nil {
		return fmt.Errorf("devworld: halal-lapse runs the expiry job on the local database (%w); run it through make dev-scenario", err)
	}
	return nil
}

// queryRower is a *pgx.Conn or a *pgxpool.Pool.
type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// restaurantHalalState reads, never writes, what the job left.
func restaurantHalalState(ctx context.Context, q queryRower, id string) (account, halal string, err error) {
	err = q.QueryRow(ctx, `SELECT account_state::text, halal_status::text FROM restaurant WHERE id = $1`, id).Scan(&account, &halal)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", errors.New("devworld: no expiring-halal restaurant; run make dev-reset")
	}
	return account, halal, err
}

// lapseSeenThroughAPI checks what a customer and the owner now see.
func lapseSeenThroughAPI(ctx context.Context, base string) error {
	amina, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	status, _, _ := amina.call(ctx, http.MethodGet, "/v1/restaurants/"+restaurantExpiring, nil, false)
	fmt.Printf("amina  GET /v1/restaurants/%s  http %d\n", restaurantExpiring, status)
	if status != http.StatusNotFound {
		return fmt.Errorf("devworld: a delisted restaurant answered %d to a customer, want 404", status)
	}
	owner, err := restaurant(ctx, base, "expiring-halal")
	if err != nil {
		return err
	}
	kinds, err := owner.notificationKinds(ctx)
	if err != nil {
		return err
	}
	if !kinds[string(halalexpiry.KindCertificateExpired)] {
		return errors.New("devworld: the expiring-halal owner has no certificate expiry notice")
	}
	fmt.Printf("expiring-halal owner  has the %s notice\n", halalexpiry.KindCertificateExpired)
	return nil
}

// notificationKinds is the set of notification kinds on the caller's first page.
func (c *apiClient) notificationKinds(ctx context.Context) (map[string]bool, error) {
	_, data, err := c.call(ctx, http.MethodGet, "/v1/notifications?limit=50", nil, false)
	if err != nil {
		return nil, fmt.Errorf("devworld: listNotifications: %w", err)
	}
	var list []struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, fmt.Errorf("devworld: listNotifications: %w", err)
	}
	out := make(map[string]bool, len(list))
	for _, n := range list {
		out[n.Kind] = true
	}
	return out, nil
}

func scenarioHalalRenew(ctx context.Context, base string) error {
	dsn := os.Getenv("HG_POSTGRES_DSN")
	if err := lapseGuard(base, os.Getenv("HG_ENV"), dsn); err != nil {
		return err
	}
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	account, halal, err := restaurantHalalState(ctx, conn, restaurantExpiring)
	if err != nil {
		return err
	}
	fmt.Printf("expiring-halal  account %s  halal %s\n", account, halal)
	if account != "DELISTED" || halal != "EXPIRED" {
		return fmt.Errorf("devworld: halal-renew renews a lapsed certificate; expiring-halal is %s and %s: run `make dev-scenario s=halal-lapse` first, after `make dev-reset` if it was already renewed", account, halal)
	}

	// 1. The owner uploads and attaches the new certificate.
	owner, err := restaurant(ctx, base, "expiring-halal")
	if err != nil {
		return err
	}
	admin, err := staff(ctx, base, "admin-seed", "admin-web")
	if err != nil {
		return err
	}
	bodyID, err := admin.acceptedIssuingBody(ctx)
	if err != nil {
		return err
	}
	certNumber := "DW-EXPIRING-RENEW-" + strings.ToUpper(randomSuffix())
	validUntil := time.Now().AddDate(1, 0, 0).Format("2006-01-02")
	objectID, err := owner.uploadPDF(ctx, "HALAL_CERTIFICATE renewal")
	if err != nil {
		return err
	}
	_, docData, err := owner.call(ctx, http.MethodPost, "/v1/restaurant/documents", map[string]any{
		"doc_type": "HALAL_CERTIFICATE", "stored_object_id": objectID,
		"issuer_body_id": bodyID, "certificate_number": certNumber, "valid_until": validUntil,
	}, true)
	if err != nil {
		return fmt.Errorf("devworld: attachRestaurantDocument HALAL_CERTIFICATE from a delisted restaurant: %w (gap: https://github.com/shaiknoorullah/hg-mono/issues/174)", err)
	}
	var doc struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(docData, &doc); err != nil || doc.ID == "" {
		return errors.New("devworld: attachRestaurantDocument returned no document id")
	}
	fmt.Printf("owner  renewal %s attached  document %s\n", certNumber, doc.ID)

	// 2. admin-seed checks it. No admin operation lists a renewal waiting for
	// checks on a restaurant that is already active: the application screen
	// covers onboarding only. So, like an emailed link, the certificate id is
	// read from the local database; everything else goes through the API.
	certID, err := renewalCertificate(ctx, conn, doc.ID)
	if err != nil {
		return err
	}
	fmt.Printf("admin  renewal certificate %s read from the local database: no admin operation lists it yet (https://github.com/shaiknoorullah/hg-mono/issues/174)\n", certID)
	if _, _, err := admin.call(ctx, http.MethodPost, "/v1/admin/restaurant-documents/"+doc.ID+"/review",
		map[string]any{"decision": "APPROVE"}, true); err != nil {
		return fmt.Errorf("devworld: reviewRestaurantDocument HALAL_CERTIFICATE: %w", err)
	}
	fmt.Println("admin  approved the renewal document")
	if err := admin.passHalalCertificate(ctx, certID, halalTranscript{
		number: certNumber, bodyID: bodyID, legalName: "Devworld Expiring Inc.",
		address: "1240 Danforth Avenue, Toronto", expiresOn: validUntil,
	}); err != nil {
		return err
	}

	// 3. The approval relisted it, in the approval's own transaction.
	account, halal, err = restaurantHalalState(ctx, conn, restaurantExpiring)
	if err != nil {
		return err
	}
	fmt.Printf("expiring-halal  account %s  halal %s\n", account, halal)
	if account != "LIVE" || halal != "CERTIFIED" {
		return fmt.Errorf("devworld: halal-renew left expiring-halal %s and %s, want LIVE and CERTIFIED", account, halal)
	}
	amina, err := customer(ctx, base, "amina")
	if err != nil {
		return err
	}
	status, _, _ := amina.call(ctx, http.MethodGet, "/v1/restaurants/"+restaurantExpiring, nil, false)
	fmt.Printf("amina  GET /v1/restaurants/%s  http %d\n", restaurantExpiring, status)
	if status != http.StatusOK {
		return fmt.Errorf("devworld: the relisted restaurant answered %d to a customer, want 200", status)
	}
	return nil
}

// renewalCertificate is the certificate the attach created for this document.
func renewalCertificate(ctx context.Context, q queryRower, documentID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `
		SELECT id::text FROM halal_certificate
		 WHERE document_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`, documentID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("devworld: the attached renewal has no certificate waiting for checks")
	}
	return id, err
}
