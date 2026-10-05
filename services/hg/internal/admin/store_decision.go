package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/rider"
)

// restaurantProfileRow is the full restaurant projection the review screen needs.
type restaurantProfileRow struct {
	ID              string
	LegalName       string
	DisplayName     string
	Description     *string
	OwnerFirstName  *string
	OwnerLastName   *string
	PhoneE164       *string
	PublicPhoneE164 *string
	GSTHSTNumber    *string
	Line1           *string
	Line2           *string
	City            *string
	Province        *string
	PostalCode      *string
	Latitude        *float64
	Longitude       *float64
	Timezone        string
	AvgPrepMinutes  int
	DeliveryRadiusM int
	AccountState    string
	OnboardingState string
	CommissionBps   int
	HalalStatus     string
	HalalCertID     *string
	CuisineIDs      []string
}

// restaurantAppDetail bundles the summary plus the review-screen detail.
type restaurantAppDetail struct {
	summary           restaurantAppRow
	profile           restaurantProfileRow
	documents         []kycDocRow
	certID            *string
	blockers          []string
	addressPinWarning bool
}

// GetRestaurantApplication loads the full review screen for one application
// (A-13). It composes the queue summary, the restaurant profile, the four
// required documents, the halal certificate id and the live blockers so the
// reviewer decides from one payload. A restaurant with no application row (never
// submitted) is ErrNotFound.
func (r *Repo) GetRestaurantApplication(ctx context.Context, restaurantID string, minRemainingDays int, at time.Time) (restaurantAppDetail, error) {
	var out restaurantAppDetail
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		out.summary, err = r.getRestaurantAppTx(ctx, tx, restaurantID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		out.profile, err = r.getRestaurantProfileTx(ctx, tx, restaurantID)
		if err != nil {
			return err
		}
		out.documents, err = r.listSubjectDocsTx(ctx, tx, "RESTAURANT", restaurantID)
		if err != nil {
			return err
		}
		out.certID, err = r.currentCertIDTx(ctx, tx, restaurantID, out.profile.HalalCertID)
		if err != nil {
			return err
		}
		var pinWarn bool
		if err := tx.QueryRow(ctx, `SELECT address_pin_warning FROM restaurant_application WHERE restaurant_id=$1`, restaurantID).Scan(&pinWarn); err != nil {
			return err
		}
		out.addressPinWarning = pinWarn
		out.blockers = restaurantBlockers(out.profile, out.documents)
		return nil
	})
	return out, err
}

// currentCertIDTx resolves the halal certificate the review screen should show
// (A-13). Once a certificate is APPROVED the derived restaurant.halal_certificate_id
// points at it, so that wins. Before approval the restaurant column is null, so we
// surface the most recent non-superseded certificate under review — otherwise the
// reviewer would have no certificate id to run the seven-check instrument against,
// which is the whole point of the review screen.
func (r *Repo) currentCertIDTx(ctx context.Context, tx pgx.Tx, restaurantID string, approvedCertID *string) (*string, error) {
	if approvedCertID != nil {
		return approvedCertID, nil
	}
	var id string
	err := tx.QueryRow(ctx, `
		SELECT id::text FROM halal_certificate
		 WHERE restaurant_id = $1 AND deleted_at IS NULL
		   AND status NOT IN ('SUPERSEDED', 'REVOKED')
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`, restaurantID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func (r *Repo) getRestaurantProfileTx(ctx context.Context, tx pgx.Tx, id string) (restaurantProfileRow, error) {
	const q = `
SELECT r.id, r.legal_name, r.display_name, r.description,
       r.phone_e164, r.public_phone_e164, r.gst_hst_number,
       r.line1, r.line2, r.city, r.province::text, r.postal_code,
       ST_Y(r.location::geometry), ST_X(r.location::geometry),
       r.timezone, r.avg_prep_minutes, r.delivery_radius_m,
       r.account_state::text, r.onboarding_state::text, r.commission_rate_bps,
       r.halal_status::text, r.halal_certificate_id::text
  FROM restaurant r
 WHERE r.id = $1 AND r.deleted_at IS NULL`
	var p restaurantProfileRow
	if err := tx.QueryRow(ctx, q, id).Scan(&p.ID, &p.LegalName, &p.DisplayName, &p.Description,
		&p.PhoneE164, &p.PublicPhoneE164, &p.GSTHSTNumber,
		&p.Line1, &p.Line2, &p.City, &p.Province, &p.PostalCode,
		&p.Latitude, &p.Longitude, &p.Timezone, &p.AvgPrepMinutes, &p.DeliveryRadiusM,
		&p.AccountState, &p.OnboardingState, &p.CommissionBps,
		&p.HalalStatus, &p.HalalCertID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return p, ErrNotFound
		}
		return p, err
	}
	// The owner name lives on the account/profile the onboarding sibling owns; the
	// restaurant row does not carry it, so these stay null in the projection.
	const cuisines = `SELECT cuisine_id::text FROM restaurant_cuisine WHERE restaurant_id=$1 ORDER BY cuisine_id`
	rows, err := tx.Query(ctx, cuisines, id)
	if err != nil {
		return p, err
	}
	defer rows.Close()
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return p, err
		}
		p.CuisineIDs = append(p.CuisineIDs, c)
	}
	return p, rows.Err()
}

// listSubjectDocsTx loads every non-deleted KYC document for one subject.
func (r *Repo) listSubjectDocsTx(ctx context.Context, tx pgx.Tx, subjectType, subjectID string) ([]kycDocRow, error) {
	const q = `
SELECT id, subject_type::text, subject_id,
       COALESCE(restaurant_doc_type::text, rider_doc_type::text) AS doc_type,
       state::text, issuer, certificate_number, issued_on, valid_until, version,
       rejection_reason_code::text, review_note, reviewed_at, created_at
  FROM kyc_document
 WHERE subject_type = $1::kyc_subject_type AND subject_id = $2 AND deleted_at IS NULL
 ORDER BY created_at ASC, id ASC`
	rows, err := tx.Query(ctx, q, subjectType, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []kycDocRow
	for rows.Next() {
		var d kycDocRow
		if err := rows.Scan(&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType, &d.State,
			&d.Issuer, &d.CertificateNumber, &d.IssuedOn, &d.ValidUntil, &d.Version,
			&d.RejectionReasonCode, &d.ReviewNote, &d.ReviewedAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// requiredRestaurantDocs is the R-07/R-08 Canadian pack that must be APPROVED
// before a restaurant application can be approved. LIABILITY_INSURANCE is
// optional at V0 and is not a blocker.
var requiredRestaurantDocs = []string{"BUSINESS_LICENCE", "HALAL_CERTIFICATE", "FOOD_SAFETY", "OWNER_ID"}

// restaurantBlockers evaluates, live, everything preventing approval (A-18):
// every required document approved, coordinates present, and an approved halal
// certificate. The list is human-readable strings, per the contract.
func restaurantBlockers(p restaurantProfileRow, docs []kycDocRow) []string {
	var blockers []string
	approved := map[string]bool{}
	for _, d := range docs {
		if d.State == "APPROVED" {
			approved[d.DocType] = true
		}
	}
	for _, req := range requiredRestaurantDocs {
		if !approved[req] {
			blockers = append(blockers, "Required document not approved: "+req)
		}
	}
	if p.Latitude == nil || p.Longitude == nil {
		blockers = append(blockers, "Premises coordinates are missing")
	}
	if p.HalalCertID == nil || p.HalalStatus != "CERTIFIED" {
		blockers = append(blockers, "No approved halal certificate")
	}
	return blockers
}

// ErrPreconditionNotMet is returned when a decision cannot proceed because the
// application is not yet approvable (A-18). It carries the live blocker list.
type preconditionError struct{ Blockers []string }

func (e preconditionError) Error() string { return "precondition not met" }

// DecideRestaurantApplication records an APPROVE/REQUEST_CHANGES/REJECT decision
// (A-18). Approval is blocked with the live blockers when any required document
// is unapproved, coordinates are missing, or there is no approved halal
// certificate. A second decision is ALREADY_DECIDED. The decider is the
// authenticated admin, never a body field. Approval does NOT make the restaurant
// live; account_state is not touched here.
func (r *Repo) DecideRestaurantApplication(ctx context.Context, actor auditActor, restaurantID, decision, reasonCode, reasonText string, minRemainingDays int, at time.Time) (restaurantAppDetail, error) {
	var out restaurantAppDetail
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var alreadyDecided *time.Time
		var curOnboarding string
		const lock = `
SELECT ra.decided_at, r.onboarding_state::text
  FROM restaurant_application ra
  JOIN restaurant r ON r.id = ra.restaurant_id
 WHERE ra.restaurant_id = $1
 FOR UPDATE OF ra`
		if err := tx.QueryRow(ctx, lock, restaurantID).Scan(&alreadyDecided, &curOnboarding); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if alreadyDecided != nil {
			return ErrAlreadyDecided
		}

		profile, err := r.getRestaurantProfileTx(ctx, tx, restaurantID)
		if err != nil {
			return err
		}
		docs, err := r.listSubjectDocsTx(ctx, tx, "RESTAURANT", restaurantID)
		if err != nil {
			return err
		}

		var approveCode, rejectCode any
		var toState string
		switch decision {
		case "APPROVE":
			blockers := restaurantBlockers(profile, docs)
			if len(blockers) > 0 {
				return preconditionError{Blockers: blockers}
			}
			approveCode = reasonCode
			toState = "DOCUMENTS_APPROVED"
		case "REJECT":
			rejectCode = reasonCode
			toState = "DOCUMENTS_REJECTED"
		case "REQUEST_CHANGES":
			rejectCode = reasonCode
			toState = "DOCUMENTS_REJECTED"
		default:
			return errBadDate
		}

		var decidedBy any
		if actor.staffID != "" {
			decidedBy = actor.staffID
		}
		const upd = `
UPDATE restaurant_application
   SET decision=$2::restaurant_decision,
       approve_reason_code=$3::restaurant_approve_reason_code,
       reject_reason_code=$4::restaurant_reject_application_reason_code,
       decided_by=$5, decided_at=now()
 WHERE restaurant_id=$1`
		if _, err := tx.Exec(ctx, upd, restaurantID, decision, approveCode, rejectCode, decidedBy); err != nil {
			return err
		}
		// The onboarding state advances on the decision (A-18). account_state is not
		// touched: approval does not make the restaurant live.
		if _, err := tx.Exec(ctx, `UPDATE restaurant SET onboarding_state=$2::restaurant_onboarding_state WHERE id=$1`, restaurantID, toState); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO restaurant_onboarding_transition
  (restaurant_id, from_state, to_state, actor_kind, actor_account_id, decision_reason_code, reason, request_id)
VALUES ($1, $2::restaurant_onboarding_state, $3::restaurant_onboarding_state, 'ADMIN', $4, $5, $6, $7)`,
			restaurantID, curOnboarding, toState, decidedBy, reasonCode, reasonText, nullStr(actor.requestID)); err != nil {
			return err
		}
		// DOCUMENTS_APPROVED → PAYOUT_PENDING is automatic (spec R, transition table);
		// recompute advances it (and no-ops on rejection, which is out of the band).
		if err := restaurant.RecomputeOnboarding(ctx, tx, restaurantID); err != nil {
			return err
		}

		if err := writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "restaurant." + decisionVerbApp(decision),
			subjectType: "RESTAURANT",
			subjectID:   &restaurantID,
			outcome:     "SUCCESS",
			reasonCode:  &reasonCode,
			reason:      &reasonText,
			before:      map[string]any{"onboarding_state": curOnboarding},
			after:       map[string]any{"onboarding_state": toState, "decision": decision},
		}); err != nil {
			return err
		}

		out.summary, err = r.getRestaurantAppTx(ctx, tx, restaurantID)
		if err != nil {
			return err
		}
		out.profile, err = r.getRestaurantProfileTx(ctx, tx, restaurantID)
		if err != nil {
			return err
		}
		out.documents, err = r.listSubjectDocsTx(ctx, tx, "RESTAURANT", restaurantID)
		if err != nil {
			return err
		}
		out.certID, err = r.currentCertIDTx(ctx, tx, restaurantID, out.profile.HalalCertID)
		if err != nil {
			return err
		}
		out.blockers = restaurantBlockers(out.profile, out.documents)
		var pinWarn bool
		if err := tx.QueryRow(ctx, `SELECT address_pin_warning FROM restaurant_application WHERE restaurant_id=$1`, restaurantID).Scan(&pinWarn); err != nil {
			return err
		}
		out.addressPinWarning = pinWarn
		return nil
	})
	return out, err
}

// --- rider ---

type riderProfileRow struct {
	AccountID       string
	FirstName       string
	LastName        string
	Email           *string
	DateOfBirth     time.Time
	OnboardingState string
}

type riderVehicleRow struct {
	ID           string
	VehicleType  string
	Make         *string
	Model        *string
	Year         *int
	Colour       *string
	LicencePlate *string
	IsActive     bool
}

type riderAppDetail struct {
	summary   riderAppRow
	profile   riderProfileRow
	vehicle   *riderVehicleRow
	documents []kycDocRow
	ageYears  *int
	blockers  []string
}

// GetRiderApplication loads the full review screen for one rider application
// (A-23): profile, active vehicle, documents, the server-computed age and the
// live blockers.
func (r *Repo) GetRiderApplication(ctx context.Context, accountID string, at time.Time) (riderAppDetail, error) {
	var out riderAppDetail
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		out.summary, err = r.getRiderAppTx(ctx, tx, accountID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		out.profile, err = r.getRiderProfileTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		out.vehicle, err = r.getRiderVehicleTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		out.documents, err = r.listSubjectDocsTx(ctx, tx, "RIDER", accountID)
		if err != nil {
			return err
		}
		out.ageYears = ptr(ageYears(out.profile.DateOfBirth, at))
		out.blockers = riderBlockers(out.profile, out.documents, *out.ageYears)
		return nil
	})
	return out, err
}

func (r *Repo) getRiderAppTx(ctx context.Context, tx pgx.Tx, id string) (riderAppRow, error) {
	const q = `
SELECT ra.account_id, (rp.first_name || ' ' || rp.last_name), rv.vehicle_type::text,
       rp.onboarding_state::text, ra.submission_count, ra.assigned_admin_id::text,
       ra.review_lock_expires_at, ra.submitted_at, ra.sla_due_at
  FROM rider_application ra
  JOIN rider_profile rp ON rp.account_id = ra.account_id
  LEFT JOIN rider_vehicle rv ON rv.account_id = ra.account_id AND rv.is_active AND rv.deleted_at IS NULL
 WHERE ra.account_id = $1`
	var a riderAppRow
	err := tx.QueryRow(ctx, q, id).Scan(&a.AccountID, &a.DisplayName, &a.VehicleType,
		&a.OnboardingState, &a.AttemptNumber, &a.AssignedAdminID, &a.ReviewLockExpiresAt,
		&a.SubmittedAt, &a.SLADueAt)
	return a, err
}

func (r *Repo) getRiderProfileTx(ctx context.Context, tx pgx.Tx, id string) (riderProfileRow, error) {
	const q = `
SELECT rp.account_id, rp.first_name, rp.last_name, a.email::text, rp.date_of_birth, rp.onboarding_state::text
  FROM rider_profile rp
  JOIN account a ON a.id = rp.account_id
 WHERE rp.account_id = $1 AND rp.deleted_at IS NULL`
	var p riderProfileRow
	err := tx.QueryRow(ctx, q, id).Scan(&p.AccountID, &p.FirstName, &p.LastName, &p.Email, &p.DateOfBirth, &p.OnboardingState)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (r *Repo) getRiderVehicleTx(ctx context.Context, tx pgx.Tx, id string) (*riderVehicleRow, error) {
	const q = `
SELECT id, vehicle_type::text, make, model, year, colour, licence_plate, is_active
  FROM rider_vehicle
 WHERE account_id = $1 AND is_active AND deleted_at IS NULL
 LIMIT 1`
	var v riderVehicleRow
	err := tx.QueryRow(ctx, q, id).Scan(&v.ID, &v.VehicleType, &v.Make, &v.Model, &v.Year, &v.Colour, &v.LicencePlate, &v.IsActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ageYears computes whole years between dob and at, in the business date sense.
func ageYears(dob, at time.Time) int {
	years := at.Year() - dob.Year()
	if at.Month() < dob.Month() || (at.Month() == dob.Month() && at.Day() < dob.Day()) {
		years--
	}
	return years
}

// riderBlockers evaluates the live blockers for a rider application (A-23). The
// under-18 blocker is server-computed and non-overridable.
func riderBlockers(p riderProfileRow, docs []kycDocRow, age int) []string {
	var blockers []string
	if age < 18 {
		blockers = append(blockers, "Rider is under 18")
	}
	approved := 0
	for _, d := range docs {
		if d.State == "APPROVED" {
			approved++
		}
	}
	if approved == 0 {
		blockers = append(blockers, "No approved identity/vehicle document")
	}
	return blockers
}

// DecideRiderApplication records a decision on a rider application (A-23).
// Age >= 18 is server-computed and blocks approval with AGE_REQUIREMENT_NOT_MET;
// it can never be overridden. Approval moves the rider to PAYOUT_PENDING (the
// rider becomes dispatchable only once Stripe reports payouts_enabled, which is
// the payments sibling's gate — not set here). A second decision is
// ALREADY_DECIDED.
func (r *Repo) DecideRiderApplication(ctx context.Context, actor auditActor, accountID, decision, reasonCode, reasonText string, at time.Time) (riderAppDetail, error) {
	var out riderAppDetail
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		var decidedAt *time.Time
		const lock = `SELECT decided_at FROM rider_application WHERE account_id=$1 FOR UPDATE`
		if err := tx.QueryRow(ctx, lock, accountID).Scan(&decidedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if decidedAt != nil {
			return ErrAlreadyDecided
		}

		profile, err := r.getRiderProfileTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		age := ageYears(profile.DateOfBirth, at)

		var toState string
		switch decision {
		case "APPROVE":
			if age < 18 {
				return ErrAgeNotMet
			}
			docs, err := r.listSubjectDocsTx(ctx, tx, "RIDER", accountID)
			if err != nil {
				return err
			}
			if b := riderBlockers(profile, docs, age); len(b) > 0 {
				return preconditionError{Blockers: b}
			}
			toState = "PAYOUT_PENDING"
		case "REJECT", "REQUEST_CHANGES":
			toState = "DOCUMENTS_REJECTED"
		default:
			return errBadDate
		}

		var decidedBy any
		if actor.staffID != "" {
			decidedBy = actor.staffID
		}
		// Only a rejection or a request for changes carries a document rejection
		// reason; an approval's reason (RiderApproveReasonCode) has no column here
		// and is kept on the audit row below (issue #163:
		// https://github.com/shaiknoorullah/hg-mono/issues/163).
		var rc any
		if decision != "APPROVE" && reasonCode != "" {
			rc = reasonCode
		}
		if _, err := tx.Exec(ctx, `
UPDATE rider_application
   SET reject_reason_code=$2::document_rejection_reason_code, review_note=$3,
       decided_by=$4, decided_at=now()
 WHERE account_id=$1`, accountID, rc, reasonText, decidedBy); err != nil {
			return err
		}
		if decision == "APPROVE" {
			if _, err := tx.Exec(ctx, `
UPDATE rider_profile SET onboarding_state=$2::rider_onboarding_state, approved_by=$3, approved_at=now()
 WHERE account_id=$1`, accountID, toState, decidedBy); err != nil {
				return err
			}
			// Payouts may already be enabled: go straight to ACTIVE.
			if err := rider.RecomputeOnboarding(ctx, tx, accountID); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `UPDATE rider_profile SET onboarding_state=$2::rider_onboarding_state WHERE account_id=$1`, accountID, toState); err != nil {
				return err
			}
		}

		if err := writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "rider." + decisionVerbApp(decision),
			subjectType: "RIDER",
			subjectID:   &accountID,
			outcome:     "SUCCESS",
			reasonCode:  &reasonCode,
			reason:      &reasonText,
			after:       map[string]any{"onboarding_state": toState, "decision": decision},
		}); err != nil {
			return err
		}

		out.summary, err = r.getRiderAppTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		out.profile, err = r.getRiderProfileTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		out.vehicle, err = r.getRiderVehicleTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		out.documents, err = r.listSubjectDocsTx(ctx, tx, "RIDER", accountID)
		if err != nil {
			return err
		}
		out.ageYears = ptr(age)
		out.blockers = riderBlockers(out.profile, out.documents, age)
		return nil
	})
	return out, err
}

// ErrAgeNotMet is returned when a rider under 18 cannot be approved (A-23).
var ErrAgeNotMet = errors.New("admin: age requirement not met")

func decisionVerbApp(decision string) string {
	switch decision {
	case "APPROVE":
		return "approve"
	case "REJECT":
		return "reject"
	case "REQUEST_CHANGES":
		return "request_changes"
	default:
		return "decide"
	}
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
