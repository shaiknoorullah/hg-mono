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

// riderMeRow holds the full set of columns required by GET /v1/riders/me,
// widened beyond riderProfileRow to include account.phone_e164,
// account.timezone, rider_profile.rating_avg, and the active vehicle.
type riderMeRow struct {
	riderProfileRow
	// From account:
	PhoneE164 *string
	Timezone  *string
	// From rider_profile:
	RatingAvg *float64
	// Active vehicle (LEFT JOIN rider_vehicle; nil when no active vehicle):
	VehicleID           *string
	VehicleType         *string
	VehicleMake         *string
	VehicleModel        *string
	VehicleYear         *int
	VehicleColour       *string
	VehicleLicencePlate *string
	VehicleIsActive     *bool
	// Active assignment (LEFT JOIN assignment; nil when no active assignment):
	ActiveAssignmentID *string
}

// GetRiderMe returns the full RiderMe projection for the given account_id,
// joining account (for phone_e164, timezone) and rider_vehicle (for the active
// vehicle). Returns ErrNotFound when no rider_profile row exists.
func (r *Repo) GetRiderMe(ctx context.Context, accountID string) (riderMeRow, error) {
	const q = `
SELECT rp.account_id, rp.first_name, rp.last_name, rp.date_of_birth,
       rp.onboarding_state, rp.account_status, rp.availability_state,
       rp.approved_at, rp.created_at, rp.updated_at,
       a.phone_e164, a.timezone,
       rp.rating_avg,
       rv.id, rv.vehicle_type::text, rv.make, rv.model, rv.year, rv.colour, rv.licence_plate, rv.is_active,
       (SELECT id::text FROM assignment
         WHERE rider_account_id = $1
           AND state NOT IN ('DELIVERED','UNDELIVERABLE','RETURNED','CANCELLED_BY_PLATFORM','REASSIGNED')
         ORDER BY assigned_at DESC LIMIT 1)
  FROM rider_profile rp
  JOIN account a ON a.id = rp.account_id
  LEFT JOIN rider_vehicle rv ON rv.account_id = rp.account_id AND rv.is_active AND rv.deleted_at IS NULL
 WHERE rp.account_id = $1 AND rp.deleted_at IS NULL`
	var row riderMeRow
	err := r.pool.QueryRow(ctx, q, accountID).Scan(
		&row.AccountID, &row.FirstName, &row.LastName, &row.DateOfBirth,
		&row.OnboardingState, &row.AccountStatus, &row.AvailabilityState,
		&row.ApprovedAt, &row.CreatedAt, &row.UpdatedAt,
		&row.PhoneE164, &row.Timezone,
		&row.RatingAvg,
		&row.VehicleID, &row.VehicleType, &row.VehicleMake, &row.VehicleModel,
		&row.VehicleYear, &row.VehicleColour, &row.VehicleLicencePlate, &row.VehicleIsActive,
		&row.ActiveAssignmentID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return riderMeRow{}, ErrNotFound
	}
	return row, err
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
//
// One file is attached once per document type: when a live row for the same
// (rider, doc_type, stored_object_id) exists, that row is returned and nothing
// is written. The database holds the rule (unique index
// kyc_document_rider_file_once, migration 00038), so two attaches of the same
// file at once cannot both insert: the second INSERT waits for the first to
// commit, does nothing, and reads the first one's row back.
func (r *Repo) AttachDocument(ctx context.Context, accountID, docType, storedObjectID string, expiresOn *time.Time) (kycDocumentRow, error) {
	// Verify stored_object ownership first (IDOR: returns 404).
	// The file must also be a compliance upload (not a delivery photo or an
	// avatar), and not attached to another subject's documents: one upload
	// backs one subject (https://github.com/shaiknoorullah/hg-mono/issues/359).
	var uploaderID string
	err := r.pool.QueryRow(ctx, `
SELECT so.uploaded_by FROM stored_object so
 WHERE so.id = $1 AND so.state = 'READY' AND so.deleted_at IS NULL
   AND so.purpose = 'KYC_DOCUMENT'
   AND NOT EXISTS (SELECT 1 FROM kyc_document kd
                    WHERE kd.stored_object_id = so.id AND kd.deleted_at IS NULL
                      AND (kd.subject_type <> 'RIDER' OR kd.subject_id <> $2))`,
		storedObjectID, accountID).Scan(&uploaderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return kycDocumentRow{}, ErrNotFound
	}
	if err != nil {
		return kycDocumentRow{}, err
	}
	if uploaderID != accountID {
		return kycDocumentRow{}, ErrNotFound
	}

	// The conflict target names the partial index's predicate so Postgres
	// matches kyc_document_rider_file_once.
	const ins = `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state,
                           valid_until, deadline_at, deadline_action)
VALUES ('RIDER', $1, $2::rider_doc_type, $3, 'SUBMITTED',
        $4,
        now() + interval '72 hours', 'ESCALATE')
ON CONFLICT (subject_id, rider_doc_type, stored_object_id)
   WHERE subject_type = 'RIDER' AND deleted_at IS NULL
   DO NOTHING
RETURNING id, subject_type, subject_id, rider_doc_type, state, version, created_at`
	// A separate statement, so it sees a row committed by a concurrent attach
	// after the INSERT began.
	const existing = `
SELECT id, subject_type, subject_id, rider_doc_type, state, version, created_at
  FROM kyc_document
 WHERE subject_type = 'RIDER' AND subject_id = $1
   AND rider_doc_type = $2::rider_doc_type AND stored_object_id = $3
   AND deleted_at IS NULL`

	var d kycDocumentRow
	err = r.pool.QueryRow(ctx, ins, accountID, docType, storedObjectID, expiresOn).Scan(
		&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType, &d.State, &d.Version, &d.CreatedAt,
	)
	if !errors.Is(err, pgx.ErrNoRows) {
		return d, err
	}
	// Already attached: return that row.
	err = r.pool.QueryRow(ctx, existing, accountID, docType, storedObjectID).Scan(
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

	// Today's earnings: sum of the rider's DELIVERY earning entries earned since
	// local midnight in the platform timezone (America/Toronto — Ontario launch).
	// "Today" is a wall-clock day for the rider, so the boundary is computed in
	// the platform zone, not UTC. gross_cents is the money field (int64 cents);
	// trips counts delivery entries. The error is NOT swallowed — a failure here
	// is a real fault and must surface, never masquerade as zero earnings.
	const todayQ = `
SELECT COALESCE(SUM(gross_cents), 0)::bigint,
       COUNT(*) FILTER (WHERE type = 'DELIVERY')::int
  FROM earning_entry
 WHERE account_id = $1
   AND earned_at >= (date_trunc('day', now() AT TIME ZONE 'America/Toronto') AT TIME ZONE 'America/Toronto')`
	if err := r.pool.QueryRow(ctx, todayQ, accountID).Scan(&row.GrossCents, &row.Trips); err != nil {
		return dashboardRow{}, err
	}

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

// riderMeResponse mirrors the RiderMe schema (additionalProperties:false).
// Required fields are always present. Optional fields use omitempty so the
// payload is a strict subset when a value is unavailable (e.g. no vehicle).
type riderMeResponse struct {
	AccountID          string           `json:"account_id"`
	FirstName          *string          `json:"first_name"`
	LastName           *string          `json:"last_name"`
	PhoneE164          *string          `json:"phone_e164,omitempty"`
	PhotoURL           *string          `json:"photo_url,omitempty"`
	OnboardingState    string           `json:"onboarding_state"`
	AccountStatus      string           `json:"account_status"`
	AvailabilityState  string           `json:"availability_state"`
	Vehicle            *vehicleResponse `json:"vehicle,omitempty"`
	ActiveAssignmentID *string          `json:"active_assignment_id,omitempty"`
	RatingAvg          *float64         `json:"rating_avg,omitempty"`
	Timezone           *string          `json:"timezone,omitempty"`
	NextRoute          string           `json:"next_route"`
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

// dashboardResponse mirrors RiderDashboard (additionalProperties:false).
// required: [mode, today, active_assignment, current_offer].
// tracking_health and blocking_reasons are optional; emitted as null/absent
// until the dispatch service populates them.
type dashboardResponse struct {
	Mode             string                 `json:"mode"`
	Today            dashboardTodayResponse `json:"today"`
	ActiveAssignment any                    `json:"active_assignment"`
	CurrentOffer     any                    `json:"current_offer"`
	TrackingHealth   any                    `json:"tracking_health,omitempty"`
	BlockingReasons  []string               `json:"blocking_reasons,omitempty"`
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

// validVehicleTypes mirrors the closed VehicleType enum in the contract. The
// handler validates against it *before* the SQL cast to ::vehicle_type so an
// unknown value returns 422 VALIDATION_FAILED rather than a 500 from a Postgres
// invalid_text_representation error (enum drift must never leak as an internal
// error).
var validVehicleTypes = map[string]bool{
	"CAR":        true,
	"SCOOTER":    true,
	"MOTORCYCLE": true,
	"BICYCLE":    true,
	"ON_FOOT":    true,
}

// validRiderDocTypes mirrors the closed RiderDocType enum in the contract. Same
// rationale as validVehicleTypes: reject unknown enum members with 422 rather
// than letting the ::rider_doc_type cast fail as a 500.
var validRiderDocTypes = map[string]bool{
	"DRIVERS_LICENCE":      true,
	"VEHICLE_REGISTRATION": true,
	"VEHICLE_INSURANCE":    true,
	"GOVERNMENT_ID":        true,
	"WORK_ELIGIBILITY":     true,
	"PROFILE_PHOTO":        true,
}

// docTypeRequiresExpiry reports whether the given rider doc type must carry an
// expires_on value. Per the contract (RiderDocumentInput.expires_on): required
// for every type except PROFILE_PHOTO.
func docTypeRequiresExpiry(docType string) bool {
	return docType != "PROFILE_PHOTO"
}

// isValidUUID reports whether s is a canonical 8-4-4-4-12 hex UUID. Used to
// reject a malformed stored_object_id before it reaches a uuid-typed SQL column
// (where a bad value would raise a 22P02 error → 500 leak).
func isValidUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
				return false
			}
		}
	}
	return true
}

// looksLikeEmail is a deliberately minimal check for the contract's
// format:email — a single '@' with a non-empty local part and a dotted domain.
// The database is the authority on uniqueness; this only rejects obvious junk so
// a malformed value is a clean 422 rather than a silently stored non-address.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	domain := s[at+1:]
	if strings.IndexByte(s[at+1:], '@') >= 0 {
		return false
	}
	dot := strings.IndexByte(domain, '.')
	return dot > 0 && dot < len(domain)-1
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// getRiderMe implements GET /v1/riders/me.
func (h *Handler) getRiderMe(w http.ResponseWriter, r *http.Request) {
	p := httpx.PrincipalFrom(r.Context())
	row, err := h.svc.repo.GetRiderMe(r.Context(), p.AccountID)
	if errors.Is(err, ErrNotFound) {
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "Rider profile not found.", nil)
		return
	}
	if err != nil {
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Internal error.", nil)
		return
	}

	// Build optional vehicle sub-object when the rider has an active vehicle.
	var vehicle *vehicleResponse
	if row.VehicleID != nil {
		v := &vehicleResponse{
			ID:           *row.VehicleID,
			IsActive:     row.VehicleIsActive != nil && *row.VehicleIsActive,
			Make:         row.VehicleMake,
			Model:        row.VehicleModel,
			Year:         row.VehicleYear,
			Colour:       row.VehicleColour,
			LicencePlate: row.VehicleLicencePlate,
		}
		if row.VehicleType != nil {
			v.VehicleType = *row.VehicleType
		}
		vehicle = v
	}

	httpx.Respond(w, r, http.StatusOK, riderMeResponse{
		AccountID:          row.AccountID,
		FirstName:          strPtr(row.FirstName),
		LastName:           strPtr(row.LastName),
		PhoneE164:          row.PhoneE164,
		PhotoURL:           nil, // populated via presigned URL when photo_object_id is non-nil; presigner not yet wired into rider package
		OnboardingState:    row.OnboardingState,
		AccountStatus:      row.AccountStatus,
		AvailabilityState:  row.AvailabilityState,
		Vehicle:            vehicle,
		ActiveAssignmentID: row.ActiveAssignmentID,
		RatingAvg:          row.RatingAvg,
		Timezone:           row.Timezone,
		NextRoute:          nextRoute(row.OnboardingState),
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

	// Validate name fields against the contract's length bounds
	// (first_name/last_name: minLength 1, maxLength 50). Trim first so a
	// whitespace-only value is treated as empty rather than silently stored.
	body.FirstName = strings.TrimSpace(body.FirstName)
	body.LastName = strings.TrimSpace(body.LastName)
	var nameErrs []httpx.FieldError
	if body.FirstName == "" {
		nameErrs = append(nameErrs, httpx.FieldError{Field: "first_name", Code: "required", Message: "first_name must not be empty"})
	} else if len(body.FirstName) > 50 {
		nameErrs = append(nameErrs, httpx.FieldError{Field: "first_name", Code: "too_long", Message: "first_name must be at most 50 characters"})
	}
	if body.LastName == "" {
		nameErrs = append(nameErrs, httpx.FieldError{Field: "last_name", Code: "required", Message: "last_name must not be empty"})
	} else if len(body.LastName) > 50 {
		nameErrs = append(nameErrs, httpx.FieldError{Field: "last_name", Code: "too_long", Message: "last_name must be at most 50 characters"})
	}
	if body.Email != nil && *body.Email != "" {
		if len(*body.Email) > 254 || !looksLikeEmail(*body.Email) {
			nameErrs = append(nameErrs, httpx.FieldError{Field: "email", Code: "invalid", Message: "email must be a valid address of at most 254 characters"})
		}
	}
	if len(nameErrs) > 0 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"One or more fields failed validation.", nameErrs)
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

	vt := strings.ToUpper(strings.TrimSpace(body.VehicleType))

	// Validate vehicle_type against the closed VehicleType enum *before* the SQL
	// cast so an unknown value is a clean 422, not a 500 from an invalid enum cast.
	if !validVehicleTypes[vt] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"vehicle_type is not a recognised value.",
			[]httpx.FieldError{{Field: "vehicle_type", Code: "invalid", Message: "must be one of CAR, SCOOTER, MOTORCYCLE, BICYCLE, ON_FOOT"}})
		return
	}

	// Validate year (contract: minimum 1990) and licence_plate length
	// (contract: minLength 2, maxLength 8) before touching the database.
	var fieldErrs []httpx.FieldError
	if body.Year != nil && *body.Year < 1990 {
		fieldErrs = append(fieldErrs, httpx.FieldError{Field: "year", Code: "out_of_range", Message: "year must be 1990 or later"})
	}
	if body.LicencePlate != nil {
		if l := len(strings.TrimSpace(*body.LicencePlate)); l > 0 && (l < 2 || l > 8) {
			fieldErrs = append(fieldErrs, httpx.FieldError{Field: "licence_plate", Code: "invalid", Message: "licence_plate must be between 2 and 8 characters"})
		}
	}
	if len(fieldErrs) > 0 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"One or more fields failed validation.", fieldErrs)
		return
	}

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

	// Validate doc_type against the closed RiderDocType enum *before* the SQL
	// cast so an unknown value is a clean 422, not a 500 from an invalid enum cast.
	docType := strings.ToUpper(strings.TrimSpace(body.DocType))
	if !validRiderDocTypes[docType] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"doc_type is not a recognised value.",
			[]httpx.FieldError{{Field: "doc_type", Code: "invalid", Message: "must be one of DRIVERS_LICENCE, VEHICLE_REGISTRATION, VEHICLE_INSURANCE, GOVERNMENT_ID, WORK_ELIGIBILITY, PROFILE_PHOTO"}})
		return
	}

	// Validate stored_object_id is a well-formed UUID before it reaches the
	// uuid-typed column; a malformed value would otherwise raise 22P02 → 500.
	if !isValidUUID(strings.TrimSpace(body.StoredObjectID)) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"stored_object_id must be a UUID.",
			[]httpx.FieldError{{Field: "stored_object_id", Code: "invalid", Message: "must be a UUID"}})
		return
	}

	// Validate expires_on: required for every doc type except PROFILE_PHOTO;
	// when present must be ≥ 30 days from now (D-05).
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
	} else if docTypeRequiresExpiry(docType) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"expires_on is required for this document type.",
			[]httpx.FieldError{{Field: "expires_on", Code: "required", Message: "expires_on is required for every type except PROFILE_PHOTO"}})
		return
	}

	doc, err := h.svc.repo.AttachDocument(r.Context(), p.AccountID, docType, strings.TrimSpace(body.StoredObjectID), expiresOn)
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
