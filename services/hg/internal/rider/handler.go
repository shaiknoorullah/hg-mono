package rider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── Action constants ────────────────────────────────────────────────────────

const (
	ActionRiderReadSelf        httpx.Action = "rider.read_self"
	ActionRiderOnboardingRead  httpx.Action = "rider.onboarding.read"
	ActionRiderOnboardingWrite httpx.Action = "rider.onboarding.write"
	ActionRiderDocumentRead    httpx.Action = "rider.document.read"
	ActionRiderDocumentWrite   httpx.Action = "rider.document.write"
	ActionRiderDashboardRead   httpx.Action = "rider.dashboard.read"
)

// ─── Error codes ─────────────────────────────────────────────────────────────

const (
	codeValidationFailed       httpx.ErrorCode = "VALIDATION_FAILED"
	codeNotFound               httpx.ErrorCode = "NOT_FOUND"
	codeUnderage               httpx.ErrorCode = "UNDERAGE"
	codeEmailInUse             httpx.ErrorCode = "EMAIL_IN_USE"
	codeImmutableAfterApproval httpx.ErrorCode = "IMMUTABLE_AFTER_APPROVAL"
	codeFieldNotApplicable     httpx.ErrorCode = "FIELD_NOT_APPLICABLE"
	codeFieldRequired          httpx.ErrorCode = "FIELD_REQUIRED"
	codePlateInUse             httpx.ErrorCode = "PLATE_IN_USE"
	codeDocumentExpiresTooSoon httpx.ErrorCode = "DOCUMENT_EXPIRES_TOO_SOON"
	codeDocumentsIncomplete    httpx.ErrorCode = "DOCUMENTS_INCOMPLETE"
)

// ─── Repository ──────────────────────────────────────────────────────────────

// Repo is the database access layer for the rider package.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo backed by the given pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// riderProfileRow holds columns read from rider_profile.
type riderProfileRow struct {
	AccountID         string
	FirstName         string
	LastName          string
	DateOfBirth       time.Time
	OnboardingState   string
	AccountStatus     string
	AvailabilityState string
	ApprovedAt        *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// GetRiderProfile returns the rider_profile row for the given account_id, or
// ErrNotFound when none exists.
func (r *Repo) GetRiderProfile(ctx context.Context, accountID string) (riderProfileRow, error) {
	const q = `
SELECT account_id, first_name, last_name, date_of_birth,
       onboarding_state, account_status, availability_state,
       approved_at, created_at, updated_at
  FROM rider_profile
 WHERE account_id = $1 AND deleted_at IS NULL`
	var row riderProfileRow
	err := r.pool.QueryRow(ctx, q, accountID).Scan(
		&row.AccountID, &row.FirstName, &row.LastName, &row.DateOfBirth,
		&row.OnboardingState, &row.AccountStatus, &row.AvailabilityState,
		&row.ApprovedAt, &row.CreatedAt, &row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return riderProfileRow{}, ErrNotFound
	}
	return row, err
}

// UpsertProfile updates first_name, last_name, date_of_birth (and optionally
// email on account) and advances onboarding_state from PHONE_VERIFIED →
// VEHICLE_PENDING. It is idempotent: re-submitting the same data succeeds.
// Returns the updated row.
func (r *Repo) UpsertProfile(ctx context.Context, accountID, firstName, lastName string, dob time.Time, email *string) (riderProfileRow, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return riderProfileRow{}, err
	}
	defer tx.Rollback(ctx)

	// Update account email if provided.
	if email != nil && *email != "" {
		if _, err := tx.Exec(ctx,
			`UPDATE account SET email = $1 WHERE id = $2`, *email, accountID); err != nil {
			if isPgUniqueViolation(err) {
				return riderProfileRow{}, ErrEmailInUse
			}
			return riderProfileRow{}, err
		}
	}

	// Update rider_profile — advance state only from PHONE_VERIFIED.
	const q = `
UPDATE rider_profile
   SET first_name        = $2,
       last_name         = $3,
       date_of_birth     = $4,
       onboarding_state  = CASE
           WHEN onboarding_state = 'PHONE_VERIFIED' THEN 'VEHICLE_PENDING'::rider_onboarding_state
           ELSE onboarding_state
         END
 WHERE account_id = $1 AND deleted_at IS NULL
RETURNING account_id, first_name, last_name, date_of_birth,
          onboarding_state, account_status, availability_state,
          approved_at, created_at, updated_at`
	var row riderProfileRow
	err = tx.QueryRow(ctx, q, accountID, firstName, lastName, dob).Scan(
		&row.AccountID, &row.FirstName, &row.LastName, &row.DateOfBirth,
		&row.OnboardingState, &row.AccountStatus, &row.AvailabilityState,
		&row.ApprovedAt, &row.CreatedAt, &row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return riderProfileRow{}, ErrNotFound
	}
	if err != nil {
		return riderProfileRow{}, err
	}
	return row, tx.Commit(ctx)
}

// riderVehicleRow is the projection returned after vehicle upsert.
type riderVehicleRow struct {
	ID           string
	AccountID    string
	VehicleType  string
	Make         *string
	Model        *string
	Year         *int
	Colour       *string
	LicencePlate *string
	IsActive     bool
	CreatedAt    time.Time
}

// UpsertVehicle deactivates any existing vehicle for the rider and inserts the
// new one, advancing onboarding_state from VEHICLE_PENDING → DOCUMENTS_PENDING.
// It returns the new vehicle row.
func (r *Repo) UpsertVehicle(ctx context.Context, accountID, vehicleType string, make, model *string, year *int, colour, plate *string) (riderVehicleRow, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return riderVehicleRow{}, err
	}
	defer tx.Rollback(ctx)

	// Deactivate any existing active vehicle.
	if _, err := tx.Exec(ctx,
		`UPDATE rider_vehicle SET is_active = false WHERE account_id = $1 AND is_active AND deleted_at IS NULL`,
		accountID); err != nil {
		return riderVehicleRow{}, err
	}

	// Insert new vehicle.
	const ins = `
INSERT INTO rider_vehicle (account_id, vehicle_type, make, model, year, colour, licence_plate, is_active)
VALUES ($1, $2::vehicle_type, $3, $4, $5, $6, $7, true)
RETURNING id, account_id, vehicle_type, make, model, year, colour, licence_plate, is_active, created_at`
	var v riderVehicleRow
	err = tx.QueryRow(ctx, ins, accountID, vehicleType, make, model, year, colour, plate).Scan(
		&v.ID, &v.AccountID, &v.VehicleType, &v.Make, &v.Model,
		&v.Year, &v.Colour, &v.LicencePlate, &v.IsActive, &v.CreatedAt,
	)
	if err != nil {
		if isPgUniqueViolation(err) {
			return riderVehicleRow{}, ErrPlateInUse
		}
		if isPgCheckViolation(err) {
			return riderVehicleRow{}, ErrPlateRequired
		}
		return riderVehicleRow{}, err
	}

	// Advance onboarding state.
	if _, err := tx.Exec(ctx,
		`UPDATE rider_profile SET onboarding_state = 'DOCUMENTS_PENDING'
         WHERE account_id = $1 AND onboarding_state = 'VEHICLE_PENDING' AND deleted_at IS NULL`,
		accountID); err != nil {
		return riderVehicleRow{}, err
	}

	return v, tx.Commit(ctx)
}

// kycDocumentRow is a projection of kyc_document for rider list response.
type kycDocumentRow struct {
	ID          string
	SubjectType string
	SubjectID   string
	DocType     string
	State       string
	Version     int
	CreatedAt   time.Time
}

// ListDocuments returns all non-deleted kyc_document rows for the rider.
func (r *Repo) ListDocuments(ctx context.Context, accountID string) ([]kycDocumentRow, error) {
	const q = `
SELECT id, subject_type, subject_id, rider_doc_type, state, version, created_at
  FROM kyc_document
 WHERE subject_type = 'RIDER' AND subject_id = $1 AND deleted_at IS NULL
 ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, q, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []kycDocumentRow
	for rows.Next() {
		var d kycDocumentRow
		if err := rows.Scan(&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType, &d.State, &d.Version, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// AttachDocument creates a kyc_document row for the rider, verifying the
// stored_object was uploaded by the same account (IDOR guard).
// Returns the created document row. Idempotent: if a document for the same
// (rider, doc_type, stored_object_id) already exists, the existing row is returned.
func (r *Repo) AttachDocument(ctx context.Context, accountID, docType, storedObjectID string, expiresOn *time.Time) (kycDocumentRow, error) {
	// Verify stored_object ownership first (IDOR: returns 404).
	var uploaderID string
	err := r.pool.QueryRow(ctx,
		`SELECT uploaded_by FROM stored_object WHERE id = $1 AND state = 'READY' AND deleted_at IS NULL`,
		storedObjectID).Scan(&uploaderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return kycDocumentRow{}, ErrNotFound
	}
	if err != nil {
		return kycDocumentRow{}, err
	}
	if uploaderID != accountID {
		return kycDocumentRow{}, ErrNotFound
	}

	// Idempotency: check if an identical document row already exists.
	var existing kycDocumentRow
	errExist := r.pool.QueryRow(ctx,
		`SELECT id, subject_type, subject_id, rider_doc_type, state, version, created_at
		   FROM kyc_document
		  WHERE subject_type = 'RIDER' AND subject_id = $1
		    AND rider_doc_type = $2::rider_doc_type AND stored_object_id = $3
		    AND deleted_at IS NULL
		  ORDER BY created_at DESC LIMIT 1`,
		accountID, docType, storedObjectID).Scan(
		&existing.ID, &existing.SubjectType, &existing.SubjectID,
		&existing.DocType, &existing.State, &existing.Version, &existing.CreatedAt,
	)
	if errExist == nil {
		// Already exists — return idempotently.
		return existing, nil
	}
	if !errors.Is(errExist, pgx.ErrNoRows) {
		return kycDocumentRow{}, errExist
	}

	var validUntil *time.Time
	if expiresOn != nil {
		validUntil = expiresOn
	}

	const ins = `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state,
                           valid_until, deadline_at, deadline_action)
VALUES ('RIDER', $1, $2::rider_doc_type, $3, 'SUBMITTED',
        $4,
        now() + interval '72 hours', 'ESCALATE')
RETURNING id, subject_type, subject_id, rider_doc_type, state, version, created_at`
	var d kycDocumentRow
	err = r.pool.QueryRow(ctx, ins, accountID, docType, storedObjectID, validUntil).Scan(
		&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType, &d.State, &d.Version, &d.CreatedAt,
	)
	return d, err
}

// ActiveVehicleType returns the vehicle_type of the rider's current active vehicle.
func (r *Repo) ActiveVehicleType(ctx context.Context, accountID string) (string, error) {
	var vt string
	err := r.pool.QueryRow(ctx,
		`SELECT vehicle_type FROM rider_vehicle WHERE account_id = $1 AND is_active AND deleted_at IS NULL LIMIT 1`,
		accountID).Scan(&vt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return vt, err
}

// SubmittedDocTypes returns the set of rider_doc_type values currently in SUBMITTED state for the rider.
func (r *Repo) SubmittedDocTypes(ctx context.Context, accountID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT DISTINCT rider_doc_type FROM kyc_document
          WHERE subject_type = 'RIDER' AND subject_id = $1
            AND state IN ('SUBMITTED', 'IN_REVIEW', 'APPROVED') AND deleted_at IS NULL`,
		accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var dt string
		if err := rows.Scan(&dt); err != nil {
			return nil, err
		}
		out = append(out, dt)
	}
	return out, rows.Err()
}

// AdvanceToDocumentsReview transitions onboarding_state from DOCUMENTS_PENDING to DOCUMENTS_REVIEW.
// It is idempotent: if already DOCUMENTS_REVIEW it is a no-op.
func (r *Repo) AdvanceToDocumentsReview(ctx context.Context, accountID string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE rider_profile SET onboarding_state = 'DOCUMENTS_REVIEW'
          WHERE account_id = $1
            AND onboarding_state IN ('DOCUMENTS_PENDING', 'DOCUMENTS_REVIEW')
            AND deleted_at IS NULL`,
		accountID)
	return err
}

// dashboardRow is the projection for getRiderDashboard.
type dashboardRow struct {
	AvailabilityState string
	IsOnline          bool
	AvailChangedAt    *time.Time
	GrossCents        int64
	Trips             int
	OnlineSeconds     int64
}

// GetDashboard returns the dashboard data for the rider.
func (r *Repo) GetDashboard(ctx context.Context, accountID string) (dashboardRow, error) {
	// Simple query: get rider state. Order totals are computed separately.
	const profileQ = `
SELECT availability_state, is_online, availability_changed_at
  FROM rider_profile
 WHERE account_id = $1 AND deleted_at IS NULL`
	var row dashboardRow
	err := r.pool.QueryRow(ctx, profileQ, accountID).Scan(
		&row.AvailabilityState, &row.IsOnline, &row.AvailChangedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return dashboardRow{}, ErrNotFound
	}
	if err != nil {
		return dashboardRow{}, err
	}

	// Online seconds: time since availability_changed_at if currently online.
	if row.IsOnline && row.AvailChangedAt != nil {
		row.OnlineSeconds = int64(time.Since(*row.AvailChangedAt).Seconds())
		if row.OnlineSeconds < 0 {
			row.OnlineSeconds = 0
		}
	}

	// Today's earnings: sum of rider_earning rows for today.
	const todayQ = `
SELECT COALESCE(SUM(amount_cents), 0)::bigint, COUNT(*)::int
  FROM rider_earning
 WHERE rider_id = $1
   AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/Toronto') AT TIME ZONE 'America/Toronto'`
	_ = r.pool.QueryRow(ctx, todayQ, accountID).Scan(&row.GrossCents, &row.Trips)
	// Ignore error — table may not exist yet; earnings are 0 by default.

	return row, nil
}

// ─── Sentinel errors ─────────────────────────────────────────────────────────

var (
	ErrNotFound      = errors.New("rider: not found")
	ErrEmailInUse    = errors.New("rider: email in use")
	ErrPlateInUse    = errors.New("rider: plate in use")
	ErrPlateRequired = errors.New("rider: plate required for motorised vehicle")
)

func isPgUniqueViolation(err error) bool {
	var pgerr *pgconn.PgError
	return errors.As(err, &pgerr) && pgerr.Code == "23505"
}

func isPgCheckViolation(err error) bool {
	var pgerr *pgconn.PgError
	return errors.As(err, &pgerr) && pgerr.Code == "23514"
}

// ─── Service ─────────────────────────────────────────────────────────────────

// Service holds the business logic for the rider domain.
type Service struct {
	repo *Repo
}

// NewService builds a Service.
func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

// ─── Handler ─────────────────────────────────────────────────────────────────

// Handler is the HTTP handler for the rider surface.
type Handler struct {
	svc *Service
}

// NewHandler builds a Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Routes registers all rider self-service endpoints on the router.
func Routes(r *httpx.Router, h *Handler) {
	r.Get("/v1/riders/me", httpx.Policy{
		Action:      ActionRiderReadSelf,
		Class:       httpx.ClassRead,
		OperationID: "getRiderMe",
	}, h.getRiderMe)

	r.Get("/v1/riders/me/onboarding/status", httpx.Policy{
		Action:      ActionRiderOnboardingRead,
		Class:       httpx.ClassRead,
		OperationID: "getRiderOnboardingStatus",
	}, h.getRiderOnboardingStatus)

	r.Post("/v1/riders/me/onboarding/profile", httpx.Policy{
		Action:      ActionRiderOnboardingWrite,
		Class:       httpx.ClassWrite,
		OperationID: "submitRiderProfile",
	}, h.submitRiderProfile)

	r.Post("/v1/riders/me/onboarding/vehicle", httpx.Policy{
		Action:      ActionRiderOnboardingWrite,
		Class:       httpx.ClassWrite,
		OperationID: "submitRiderVehicle",
	}, h.submitRiderVehicle)

	r.Get("/v1/riders/me/documents", httpx.Policy{
		Action:      ActionRiderDocumentRead,
		Class:       httpx.ClassRead,
		OperationID: "listRiderDocuments",
	}, h.listRiderDocuments)

	r.Post("/v1/riders/me/documents", httpx.Policy{
		Action:      ActionRiderDocumentWrite,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "attachRiderDocument",
	}, h.attachRiderDocument)

	r.Post("/v1/riders/me/onboarding/documents", httpx.Policy{
		Action:      ActionRiderOnboardingWrite,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "submitRiderDocuments",
	}, h.submitRiderDocuments)

	r.Get("/v1/riders/me/dashboard", httpx.Policy{
		Action:      ActionRiderDashboardRead,
		Class:       httpx.ClassRead,
		OperationID: "getRiderDashboard",
	}, h.getRiderDashboard)
}

// ─── Wire structs ────────────────────────────────────────────────────────────

// riderMeResponse mirrors the RiderMe schema. Fields are limited to those the
// contract declares (additionalProperties:false); optional fields the server
// does not populate are elided with omitempty so the payload stays a strict
// subset of RiderMe.
type riderMeResponse struct {
	AccountID         string  `json:"account_id"`
	FirstName         *string `json:"first_name"`
	LastName          *string `json:"last_name"`
	OnboardingState   string  `json:"onboarding_state"`
	AccountStatus     string  `json:"account_status"`
	AvailabilityState string  `json:"availability_state"`
	NextRoute         string  `json:"next_route"`
}

// riderProfileResponse mirrors the RiderProfile schema returned by
// submitRiderProfile — a distinct, narrower shape than RiderMe.
type riderProfileResponse struct {
	AccountID   string  `json:"account_id"`
	FirstName   string  `json:"first_name"`
	LastName    string  `json:"last_name"`
	Email       *string `json:"email,omitempty"`
	DateOfBirth string  `json:"date_of_birth"`
}

// onboardingStatusResponse mirrors RiderOnboardingStatus.
type onboardingStatusResponse struct {
	OnboardingState string                `json:"onboarding_state"`
	AccountStatus   string                `json:"account_status"`
	ProgressPercent int                   `json:"progress_percent"`
	NextStep        string                `json:"next_step"`
	Documents       []kycDocumentResponse `json:"documents"`
	StepsCompleted  stepsCompleted        `json:"steps_completed"`
}

type stepsCompleted struct {
	PhoneVerified      bool `json:"phone_verified"`
	Profile            bool `json:"profile"`
	Vehicle            bool `json:"vehicle"`
	DocumentsSubmitted bool `json:"documents_submitted"`
	DocumentsApproved  bool `json:"documents_approved"`
	PayoutOnboarded    bool `json:"payout_onboarded"`
}

// submitProfileRequest is the inbound body for submitRiderProfile.
// additionalProperties:false is enforced by DisallowUnknownFields in the decoder.
type submitProfileRequest struct {
	FirstName   string  `json:"first_name"`
	LastName    string  `json:"last_name"`
	DateOfBirth string  `json:"date_of_birth"`
	Email       *string `json:"email"`
}

// submitVehicleRequest is the inbound body for submitRiderVehicle.
type submitVehicleRequest struct {
	VehicleType  string  `json:"vehicle_type"`
	Make         *string `json:"make"`
	Model        *string `json:"model"`
	Year         *int    `json:"year"`
	Colour       *string `json:"colour"`
	LicencePlate *string `json:"licence_plate"`
}

// kycDocumentResponse mirrors RiderDocument.
type kycDocumentResponse struct {
	ID          string `json:"id"`
	SubjectType string `json:"subject_type"`
	SubjectID   string `json:"subject_id"`
	DocType     string `json:"doc_type"`
	State       string `json:"state"`
	Version     int    `json:"version"`
	CreatedAt   string `json:"created_at"`
}

// attachDocumentRequest is the inbound body for attachRiderDocument.
type attachDocumentRequest struct {
	DocType        string  `json:"doc_type"`
	StoredObjectID string  `json:"stored_object_id"`
	ExpiresOn      *string `json:"expires_on"`
}

// vehicleResponse mirrors RiderVehicle. The schema is closed
// (additionalProperties:false) to {id, vehicle_type, make, model, year, colour,
// licence_plate, is_active} — account_id and created_at are deliberately not on
// the wire shape.
type vehicleResponse struct {
	ID           string  `json:"id"`
	VehicleType  string  `json:"vehicle_type"`
	Make         *string `json:"make"`
	Model        *string `json:"model"`
	Year         *int    `json:"year"`
	Colour       *string `json:"colour"`
	LicencePlate *string `json:"licence_plate"`
	IsActive     bool    `json:"is_active"`
}

// dashboardTodayResponse mirrors RiderDashboardToday.
type dashboardTodayResponse struct {
	GrossCents    int64  `json:"gross_cents"`
	Currency      string `json:"currency"`
	Trips         int    `json:"trips"`
	OnlineSeconds int64  `json:"online_seconds"`
}

// dashboardResponse mirrors RiderDashboard.
type dashboardResponse struct {
	Mode             string                 `json:"mode"`
	Today            dashboardTodayResponse `json:"today"`
	ActiveAssignment any                    `json:"active_assignment"`
	CurrentOffer     any                    `json:"current_offer"`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// decodeJSON strictly decodes the request body, refusing unknown fields
// (additionalProperties:false) and trailing content.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"The request body could not be parsed against the schema.",
			[]httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return false
	}
	if dec.More() {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"Trailing content in request body.", nil)
		return false
	}
	return true
}

// nextRoute derives the server-side routing decision from the onboarding state.
// It returns a value from the closed NextRoute enum in the contract — never a
// client-side path — so the app maps a known value to a screen and an unknown
// value to "please update the app" rather than crashing.
func nextRoute(state string) string {
	switch state {
	case "REGISTERED", "PHONE_VERIFIED", "PROFILE_PENDING":
		return "ONBOARDING_PROFILE"
	case "VEHICLE_PENDING":
		return "ONBOARDING_VEHICLE"
	case "DOCUMENTS_PENDING":
		return "ONBOARDING_DOCUMENTS"
	case "DOCUMENTS_REVIEW":
		return "ONBOARDING_AWAITING_REVIEW"
	case "DOCUMENTS_REJECTED":
		return "ONBOARDING_REJECTED"
	case "DOCUMENTS_APPROVED", "PAYOUT_PENDING":
		return "ONBOARDING_PAYOUT"
	case "ACTIVE":
		return "HOME"
	}
	return "ONBOARDING_PROFILE"
}

// onboardingProgress maps onboarding_state to a progress percentage.
func onboardingProgress(state string) int {
	switch state {
	case "REGISTERED":
		return 0
	case "PHONE_VERIFIED", "PROFILE_PENDING":
		return 10
	case "VEHICLE_PENDING":
		return 30
	case "DOCUMENTS_PENDING":
		return 50
	case "DOCUMENTS_REVIEW":
		return 70
	case "DOCUMENTS_APPROVED":
		return 85
	case "PAYOUT_PENDING":
		return 90
	case "ACTIVE":
		return 100
	default:
		return 0
	}
}

// nextStep derives the next onboarding step from the onboarding_state.
func nextStep(state string) string {
	switch state {
	case "REGISTERED", "PHONE_VERIFIED", "PROFILE_PENDING":
		return "PROFILE"
	case "VEHICLE_PENDING":
		return "VEHICLE"
	case "DOCUMENTS_PENDING":
		return "DOCUMENTS"
	case "DOCUMENTS_REVIEW":
		return "AWAITING_REVIEW"
	case "DOCUMENTS_REJECTED":
		return "FIX_DOCUMENTS"
	case "DOCUMENTS_APPROVED", "PAYOUT_PENDING":
		return "PAYOUT"
	case "ACTIVE":
		return "DONE"
	}
	return "PROFILE"
}

// stepsFrom derives completed steps from the onboarding_state.
func stepsFrom(state string) stepsCompleted {
	states := map[string]int{
		"REGISTERED":         0,
		"PHONE_VERIFIED":     1,
		"PROFILE_PENDING":    1,
		"VEHICLE_PENDING":    2,
		"DOCUMENTS_PENDING":  3,
		"DOCUMENTS_REVIEW":   4,
		"DOCUMENTS_APPROVED": 5,
		"DOCUMENTS_REJECTED": 4,
		"PAYOUT_PENDING":     5,
		"ACTIVE":             6,
	}
	rank := states[state]
	return stepsCompleted{
		PhoneVerified:      rank >= 1,
		Profile:            rank >= 2,
		Vehicle:            rank >= 3,
		DocumentsSubmitted: rank >= 4,
		DocumentsApproved:  rank >= 5,
		PayoutOnboarded:    rank >= 6,
	}
}

// motorisedVehicleTypes is the set of vehicle types that require a licence plate.
var motorisedVehicleTypes = map[string]bool{
	"CAR":        true,
	"SCOOTER":    true,
	"MOTORCYCLE": true,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// getRiderMe implements GET /v1/riders/me.
func (h *Handler) getRiderMe(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	row, err := h.svc.repo.GetRiderProfile(r.Context(), p.AccountID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Rider profile not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, riderMeResponse{
		AccountID:         row.AccountID,
		FirstName:         strPtr(row.FirstName),
		LastName:          strPtr(row.LastName),
		OnboardingState:   row.OnboardingState,
		AccountStatus:     row.AccountStatus,
		AvailabilityState: row.AvailabilityState,
		NextRoute:         nextRoute(row.OnboardingState),
	})
}

// strPtr returns a pointer to s, or nil when s is empty, so an unset optional
// nullable string is rendered as JSON null rather than an empty string.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// getRiderOnboardingStatus implements GET /v1/riders/me/onboarding/status.
func (h *Handler) getRiderOnboardingStatus(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	row, err := h.svc.repo.GetRiderProfile(r.Context(), p.AccountID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Rider profile not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	status, err := h.buildOnboardingStatus(r.Context(), p.AccountID, row)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, status)
}

// buildOnboardingStatus assembles the RiderOnboardingStatus payload from the
// rider's profile row and current document set. It is shared by the onboarding
// status read and the document-submission write so both return the exact same
// contract shape.
func (h *Handler) buildOnboardingStatus(ctx context.Context, accountID string, row riderProfileRow) (onboardingStatusResponse, error) {
	docs, err := h.svc.repo.ListDocuments(ctx, accountID)
	if err != nil {
		return onboardingStatusResponse{}, err
	}
	docResp := make([]kycDocumentResponse, 0, len(docs))
	for _, d := range docs {
		docResp = append(docResp, kycDocumentResponse{
			ID:          d.ID,
			SubjectType: d.SubjectType,
			SubjectID:   d.SubjectID,
			DocType:     d.DocType,
			State:       d.State,
			Version:     d.Version,
			CreatedAt:   httpx.Timestamp(d.CreatedAt),
		})
	}
	return onboardingStatusResponse{
		OnboardingState: row.OnboardingState,
		AccountStatus:   row.AccountStatus,
		ProgressPercent: onboardingProgress(row.OnboardingState),
		NextStep:        nextStep(row.OnboardingState),
		Documents:       docResp,
		StepsCompleted:  stepsFrom(row.OnboardingState),
	}, nil
}

// submitRiderProfile implements POST /v1/riders/me/onboarding/profile.
func (h *Handler) submitRiderProfile(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())

	var body submitProfileRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Validate date_of_birth.
	dob, err := time.Parse("2006-01-02", body.DateOfBirth)
	if err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"date_of_birth must be YYYY-MM-DD.",
			[]httpx.FieldError{{Field: "date_of_birth", Code: "invalid", Message: err.Error()}})
		return
	}

	// Age gate: rider must be ≥ 18 years old.
	cutoff := time.Now().AddDate(-18, 0, 0)
	if dob.After(cutoff) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeUnderage,
			"Rider must be at least 18 years old.", nil)
		return
	}

	// Check if approved_at is set (immutable DOB after approval).
	existing, err := h.svc.repo.GetRiderProfile(r.Context(), p.AccountID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	if err == nil && existing.ApprovedAt != nil {
		// Check if DOB is being changed.
		if !existing.DateOfBirth.Equal(dob) {
			httpx.Fail(w, r, http.StatusConflict, codeImmutableAfterApproval,
				"Date of birth cannot be changed after approval.", nil)
			return
		}
	}

	row, err := h.svc.repo.UpsertProfile(r.Context(), p.AccountID, body.FirstName, body.LastName, dob, body.Email)
	if errors.Is(err, ErrEmailInUse) {
		httpx.Fail(w, r, http.StatusConflict, codeEmailInUse, "Email is already in use.", nil)
		return
	}
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Rider profile not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	var email *string
	if body.Email != nil && *body.Email != "" {
		email = body.Email
	}
	httpx.Respond(w, r, http.StatusOK, riderProfileResponse{
		AccountID:   row.AccountID,
		FirstName:   row.FirstName,
		LastName:    row.LastName,
		Email:       email,
		DateOfBirth: row.DateOfBirth.Format("2006-01-02"),
	})
}

// submitRiderVehicle implements POST /v1/riders/me/onboarding/vehicle.
func (h *Handler) submitRiderVehicle(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())

	var body submitVehicleRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	vt := strings.ToUpper(body.VehicleType)

	// Non-motorised vehicles must not have a licence plate.
	if !motorisedVehicleTypes[vt] && body.LicencePlate != nil && *body.LicencePlate != "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeFieldNotApplicable,
			"licence_plate is not applicable for this vehicle type.",
			[]httpx.FieldError{{Field: "licence_plate", Code: "not_applicable", Message: "licence_plate must be absent for BICYCLE and ON_FOOT"}})
		return
	}

	// Motorised vehicles require a licence plate.
	if motorisedVehicleTypes[vt] && (body.LicencePlate == nil || *body.LicencePlate == "") {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeFieldRequired,
			"licence_plate is required for motorised vehicles.",
			[]httpx.FieldError{{Field: "licence_plate", Code: "required", Message: "licence_plate is required for CAR, SCOOTER, MOTORCYCLE"}})
		return
	}

	v, err := h.svc.repo.UpsertVehicle(r.Context(), p.AccountID, vt,
		body.Make, body.Model, body.Year, body.Colour, body.LicencePlate)
	if errors.Is(err, ErrPlateInUse) {
		httpx.Fail(w, r, http.StatusConflict, codePlateInUse, "Licence plate is already registered to another vehicle.", nil)
		return
	}
	if errors.Is(err, ErrPlateRequired) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeFieldRequired,
			"licence_plate is required for motorised vehicles.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, vehicleResponse{
		ID:           v.ID,
		VehicleType:  v.VehicleType,
		Make:         v.Make,
		Model:        v.Model,
		Year:         v.Year,
		Colour:       v.Colour,
		LicencePlate: v.LicencePlate,
		IsActive:     v.IsActive,
	})
}

// listRiderDocuments implements GET /v1/riders/me/documents.
func (h *Handler) listRiderDocuments(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	docs, err := h.svc.repo.ListDocuments(r.Context(), p.AccountID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	resp := make([]kycDocumentResponse, 0, len(docs))
	for _, d := range docs {
		resp = append(resp, kycDocumentResponse{
			ID:          d.ID,
			SubjectType: d.SubjectType,
			SubjectID:   d.SubjectID,
			DocType:     d.DocType,
			State:       d.State,
			Version:     d.Version,
			CreatedAt:   httpx.Timestamp(d.CreatedAt),
		})
	}
	httpx.Respond(w, r, http.StatusOK, resp)
}

// attachRiderDocument implements POST /v1/riders/me/documents.
func (h *Handler) attachRiderDocument(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())

	var body attachDocumentRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Validate expires_on: if present, must be ≥ 30 days from now (D-05).
	// PROFILE_PHOTO is exempt from expiry requirement.
	var expiresOn *time.Time
	if body.ExpiresOn != nil && *body.ExpiresOn != "" {
		exp, err := time.Parse("2006-01-02", *body.ExpiresOn)
		if err != nil {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
				"expires_on must be YYYY-MM-DD.", nil)
			return
		}
		minExp := time.Now().AddDate(0, 0, 30)
		if exp.Before(minExp) {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeDocumentExpiresTooSoon,
				"Document must be valid for at least 30 days.", nil)
			return
		}
		expiresOn = &exp
	}

	doc, err := h.svc.repo.AttachDocument(r.Context(), p.AccountID, body.DocType, body.StoredObjectID, expiresOn)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Stored object not found or not owned by this account.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusCreated, kycDocumentResponse{
		ID:          doc.ID,
		SubjectType: doc.SubjectType,
		SubjectID:   doc.SubjectID,
		DocType:     doc.DocType,
		State:       doc.State,
		Version:     doc.Version,
		CreatedAt:   httpx.Timestamp(doc.CreatedAt),
	})
}

// submitRiderDocuments implements POST /v1/riders/me/onboarding/documents.
func (h *Handler) submitRiderDocuments(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())

	// Determine required document types based on vehicle.
	vt, err := h.svc.repo.ActiveVehicleType(r.Context(), p.AccountID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	required := requiredDocTypes(vt)

	// Check which have been submitted.
	submitted, err := h.svc.repo.SubmittedDocTypes(r.Context(), p.AccountID)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	submittedSet := make(map[string]bool, len(submitted))
	for _, dt := range submitted {
		submittedSet[dt] = true
	}

	var missing []string
	for _, req := range required {
		if !submittedSet[req] {
			missing = append(missing, req)
		}
	}
	if len(missing) > 0 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeDocumentsIncomplete,
			"Required documents are missing.", map[string]any{"missing": missing})
		return
	}

	// Advance state.
	if err := h.svc.repo.AdvanceToDocumentsReview(r.Context(), p.AccountID); err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	// The contract returns the full RiderOnboardingStatus, not a bare
	// {onboarding_state}. Re-read the freshly advanced profile so the payload
	// reflects the new state and current document set.
	row, err := h.svc.repo.GetRiderProfile(r.Context(), p.AccountID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Rider profile not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	status, err := h.buildOnboardingStatus(r.Context(), p.AccountID, row)
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, status)
}

// requiredDocTypes returns the required rider_doc_types for the given vehicle type.
func requiredDocTypes(vehicleType string) []string {
	base := []string{"GOVERNMENT_ID", "PROFILE_PHOTO"}
	if motorisedVehicleTypes[vehicleType] {
		return append([]string{"DRIVERS_LICENCE", "VEHICLE_REGISTRATION", "VEHICLE_INSURANCE"}, base...)
	}
	return base
}

// getRiderDashboard implements GET /v1/riders/me/dashboard.
func (h *Handler) getRiderDashboard(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	row, err := h.svc.repo.GetDashboard(r.Context(), p.AccountID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Rider profile not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	httpx.Respond(w, r, http.StatusOK, dashboardResponse{
		Mode: row.AvailabilityState,
		Today: dashboardTodayResponse{
			GrossCents:    row.GrossCents,
			Currency:      "CAD",
			Trips:         row.Trips,
			OnlineSeconds: row.OnlineSeconds,
		},
		ActiveAssignment: nil,
		CurrentOffer:     nil,
	})
}
