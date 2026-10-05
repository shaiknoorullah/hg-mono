package restaurant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
)

// ErrNotFound is returned when a queried entity does not exist or belongs to
// another restaurant (IDOR guard — always 404, never 403).
var ErrNotFound = errors.New("not found")

// ErrCategoryNameTaken is returned when a menu category with the same name
// already exists in the restaurant.
var ErrCategoryNameTaken = errors.New("category name taken")

// ErrIncompleteDocumentPack is returned when submitRestaurantDocuments is
// called but not all required document types are in a reviewable state.
var ErrIncompleteDocumentPack = errors.New("incomplete document pack")

// ErrIllegalTransition is returned when an order state transition is not
// permitted by the machine.
var ErrIllegalTransition = errors.New("illegal transition")

// ErrOfferExpired is returned when a RESTAURANT_PENDING order's 180s window
// has elapsed before the restaurant accepted.
var ErrOfferExpired = errors.New("offer expired")

// ErrDelayLimitReached is returned when a PREPARING order already has 3
// delay events recorded (R-26).
var ErrDelayLimitReached = errors.New("delay limit reached")

// ErrHalalCertMissingFields is returned when a HALAL_CERTIFICATE document is
// attached without the fields the certificate entity requires (issuer body,
// certificate number, valid_until). A halal claim with no issuing body is
// unverifiable, so it is refused at attach time (R-07).
var ErrHalalCertMissingFields = errors.New("halal certificate fields missing")

// ErrDocumentAlreadyExpired is returned when a certificate/document is attached
// with a valid_until in the past — refused at attach time, not discovered at
// review time (contract R-07, DOCUMENT_ALREADY_EXPIRED).
var ErrDocumentAlreadyExpired = errors.New("document already expired")

// ErrUnrecognisedCertifier is returned when a HALAL_CERTIFICATE names an
// issuing body that is not in the registry (contract R-07, UNRECOGNISED_CERTIFIER).
var ErrUnrecognisedCertifier = errors.New("unrecognised certifier")

// ErrUploadNotFound is returned when an attach names a file the caller may not
// use: no such upload, or one that is not the caller's own, not confirmed, not
// uploaded for this use, or already attached somewhere else. All of these are
// the same 404, so the answer says nothing about whether the file exists
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
var ErrUploadNotFound = errors.New("upload not found")

// GetOnboardingStatus returns the onboarding state and a coarse progress
// percentage for the restaurant the account is scoped to.
func (r *Repo) GetOnboardingStatus(ctx context.Context, restaurantID string) (*OnboardingStatus, error) {
	var state, accountState string
	var halalStatus string
	var profileOK bool // has the restaurant filled in the key profile fields?
	err := r.db.QueryRow(ctx, `
		SELECT onboarding_state::text, account_state::text, halal_status::text,
		       (line1 IS NOT NULL AND province IS NOT NULL AND postal_code IS NOT NULL
		        AND location IS NOT NULL AND avg_prep_minutes > 0)
		  FROM restaurant WHERE id = $1 AND deleted_at IS NULL`,
		restaurantID).Scan(&state, &accountState, &halalStatus, &profileOK)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get onboarding state: %w", err)
	}

	// Documents uploaded: any required doc type present (not rejected).
	var distinctRequiredDocs int
	_ = r.db.QueryRow(ctx, `
		SELECT count(DISTINCT restaurant_doc_type) FROM kyc_document
		 WHERE subject_id = $1 AND subject_type = 'RESTAURANT'
		   AND restaurant_doc_type = ANY($2::restaurant_doc_type[])
		   AND state NOT IN ('REJECTED') AND deleted_at IS NULL`,
		restaurantID, requiredRestaurantDocTypes).Scan(&distinctRequiredDocs)

	// Documents submitted / approved: distinct required types in SUBMITTED+ / APPROVED.
	var submittedDocs, approvedDocs int
	_ = r.db.QueryRow(ctx, `
		SELECT count(DISTINCT restaurant_doc_type) FROM kyc_document
		 WHERE subject_id = $1 AND subject_type = 'RESTAURANT'
		   AND restaurant_doc_type = ANY($2::restaurant_doc_type[])
		   AND state IN ('SUBMITTED','IN_REVIEW','APPROVED') AND deleted_at IS NULL`,
		restaurantID, requiredRestaurantDocTypes).Scan(&submittedDocs)
	_ = r.db.QueryRow(ctx, `
		SELECT count(DISTINCT restaurant_doc_type) FROM kyc_document
		 WHERE subject_id = $1 AND subject_type = 'RESTAURANT'
		   AND restaurant_doc_type = ANY($2::restaurant_doc_type[])
		   AND state = 'APPROVED' AND deleted_at IS NULL`,
		restaurantID, requiredRestaurantDocTypes).Scan(&approvedDocs)

	// Menu published: at least one approved menu item version.
	var menuPublished bool
	_ = r.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM menu_item_version
			 WHERE restaurant_id = $1 AND review_status = 'APPROVED')`,
		restaurantID).Scan(&menuPublished)

	required := len(requiredRestaurantDocTypes)
	steps := OnboardingSteps{
		Profile:            profileOK,
		DocumentsUploaded:  distinctRequiredDocs > 0,
		DocumentsSubmitted: submittedDocs >= required,
		DocumentsApproved:  approvedDocs >= required,
		PayoutAccount:      false,
		MenuPublished:      menuPublished,
	}

	// Progress: six weighted checks (one per step).
	checks := 0
	for _, ok := range []bool{steps.Profile, steps.DocumentsUploaded, steps.DocumentsSubmitted,
		steps.DocumentsApproved, steps.PayoutAccount, steps.MenuPublished} {
		if ok {
			checks++
		}
	}
	pct := (checks * 100) / 6

	return &OnboardingStatus{
		OnboardingState: state,
		AccountState:    accountState,
		CurrentStep:     onboardingCurrentStep(state, steps),
		ProgressPercent: pct,
		StepsCompleted:  steps,
	}, nil
}

// onboardingCurrentStep derives the current_step enum (contract:
// [PROFILE, DOCUMENTS, AWAITING_REVIEW, FIX_DOCUMENTS, PAYOUT, MENU, DONE])
// from the onboarding_state and the completed steps.
func onboardingCurrentStep(state string, steps OnboardingSteps) string {
	switch state {
	case "REGISTERED", "EMAIL_VERIFIED", "PROFILE_PENDING":
		return "PROFILE"
	case "DOCUMENTS_PENDING":
		return "DOCUMENTS"
	case "DOCUMENTS_REVIEW":
		return "AWAITING_REVIEW"
	case "DOCUMENTS_REJECTED":
		return "FIX_DOCUMENTS"
	case "DOCUMENTS_APPROVED", "PAYOUT_PENDING":
		return "PAYOUT"
	case "MENU_PENDING":
		return "MENU"
	case "ACTIVE":
		return "DONE"
	}
	if !steps.Profile {
		return "PROFILE"
	}
	if !steps.DocumentsUploaded {
		return "DOCUMENTS"
	}
	if !steps.MenuPublished {
		return "MENU"
	}
	return "DONE"
}

// GetProfile returns the restaurant's profile for its own editing view.
func (r *Repo) GetProfile(ctx context.Context, restaurantID string) (*RestaurantProfile, error) {
	var p RestaurantProfile
	var province, postalCode, city, line1 *string
	var line2 *string
	var lat, lon *float64
	var halalStatus, accountState string
	var certifyingBody *string
	var certExpiresOn *time.Time
	err := r.db.QueryRow(ctx, `
		SELECT r.id::text, r.legal_name, r.display_name, r.description,
		       r.phone_e164, r.public_phone_e164, r.gst_hst_number,
		       r.province::text, r.postal_code, r.city, r.line1, r.line2,
		       ST_Y(r.location::geometry), ST_X(r.location::geometry),
		       r.timezone, r.avg_prep_minutes, r.delivery_radius_m,
		       r.halal_status::text, r.onboarding_state::text, r.account_state::text,
		       hcb.name, hc.expires_on
		  FROM restaurant r
		  LEFT JOIN halal_certificate hc ON hc.id = r.halal_certificate_id
		  LEFT JOIN halal_issuing_body hcb ON hcb.id = hc.issuing_body_id
		 WHERE r.id = $1 AND r.deleted_at IS NULL`, restaurantID).Scan(
		&p.ID, &p.LegalName, &p.DisplayName, &p.Description,
		&p.PhoneE164, &p.PublicPhoneE164, &p.GstHstNumber,
		&province, &postalCode, &city, &line1, &line2,
		&lat, &lon,
		&p.Timezone, &p.AvgPrepMinutes, &p.DeliveryRadiusM,
		&halalStatus, &p.OnboardingState, &accountState,
		&certifyingBody, &certExpiresOn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get profile: %w", err)
	}
	p.AccountState = accountState
	// Nested PublicAddress. Fields are non-null for a LIVE restaurant; use zero
	// values for a partially-onboarded one rather than emitting a bare object.
	p.Address = PublicAddress{Line2: line2}
	if line1 != nil {
		p.Address.Line1 = *line1
	}
	if city != nil {
		p.Address.City = *city
	}
	if province != nil {
		p.Address.Province = *province
	}
	if postalCode != nil {
		p.Address.PostalCode = *postalCode
	}
	if lat != nil {
		p.Address.Latitude = *lat
	}
	if lon != nil {
		p.Address.Longitude = *lon
	}
	// Halal badge (C-12): a nested HalalBadge, never a flat string, never omitted.
	p.Halal = &HalalBadge{DisplayState: halalStatus, CertifyingBodyName: certifyingBody}
	if certExpiresOn != nil {
		s := certExpiresOn.Format("2006-01-02")
		p.Halal.ExpiresOn = &s
	}

	// Cuisine IDs.
	rows, err := r.db.Query(ctx, `SELECT cuisine_id::text FROM restaurant_cuisine WHERE restaurant_id = $1`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	p.CuisineIDs = []string{}
	for rows.Next() {
		var cid string
		if err := rows.Scan(&cid); err != nil {
			return nil, err
		}
		p.CuisineIDs = append(p.CuisineIDs, cid)
	}
	return &p, rows.Err()
}

// UpsertProfile writes the restaurant's editable fields (profile+address+location).
// It returns the updated profile. Uses ON CONFLICT DO UPDATE for idempotency.
func (r *Repo) UpsertProfile(ctx context.Context, restaurantID string, in profileInputDTO) (*RestaurantProfile, error) {
	// Build the location if lat/lon are provided.
	var locExpr string
	args := []any{
		restaurantID,
		in.LegalName,
		in.DisplayName,
		in.Description,
		in.PhoneE164,
		in.PublicPhoneE164,
		in.GstHstNumber,
		in.Province,
		in.PostalCode,
		in.City,
		in.Line1,
		in.Line2,
		in.Timezone,
		in.AvgPrepMinutes,
	}
	if in.Latitude != 0 && in.Longitude != 0 {
		args = append(args, in.Longitude, in.Latitude)
		locExpr = fmt.Sprintf("ST_SetSRID(ST_MakePoint($%d,$%d),4326)::geography", len(args)-1, len(args))
	} else {
		locExpr = "location" // keep existing
	}

	q := fmt.Sprintf(`
		UPDATE restaurant SET
			legal_name=$2, display_name=$3, description=$4,
			phone_e164=$5, public_phone_e164=$6, gst_hst_number=$7,
			province=$8::province, postal_code=$9, city=$10, line1=$11, line2=$12,
			timezone=COALESCE($13,timezone),
			avg_prep_minutes=COALESCE($14,avg_prep_minutes),
			location=%s,
			updated_at=now()
		WHERE id=$1 AND deleted_at IS NULL`, locExpr)

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, q, args...); err != nil {
		return nil, fmt.Errorf("upsert profile: %w", err)
	}

	// Persist the cuisine set (R-05): the profile carries the restaurant's cuisine
	// choices from the server-managed lookup, and the review screen and discovery
	// filters both read restaurant_cuisine. Replace the set on each save.
	if in.CuisineIDs != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM restaurant_cuisine WHERE restaurant_id=$1`, restaurantID); err != nil {
			return nil, fmt.Errorf("clear cuisines: %w", err)
		}
		for _, cid := range in.CuisineIDs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO restaurant_cuisine (restaurant_id, cuisine_id)
				VALUES ($1, $2::uuid)
				ON CONFLICT (restaurant_id, cuisine_id) DO NOTHING`, restaurantID, cid); err != nil {
				return nil, fmt.Errorf("attach cuisine: %w", err)
			}
		}
	}

	// The first valid profile save advances onboarding to DOCUMENTS_PENDING (R-05).
	// Monotonic: a restaurant already past PROFILE_PENDING is left where it is.
	if _, err := tx.Exec(ctx, `
		UPDATE restaurant SET onboarding_state='DOCUMENTS_PENDING', updated_at=now()
		 WHERE id=$1 AND deleted_at IS NULL
		   AND onboarding_state IN ('PROFILE_PENDING','EMAIL_VERIFIED','REGISTERED')`,
		restaurantID); err != nil {
		return nil, fmt.Errorf("advance onboarding: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetProfile(ctx, restaurantID)
}

// GetHours returns the restaurant's weekly trading hours and date overrides.
func (r *Repo) GetHours(ctx context.Context, restaurantID string) (*HoursView, error) {
	out := &HoursView{
		Intervals: []HoursSlotRow{},
		Overrides: []HoursOverrideRow{},
	}
	// Timezone is a required field on RestaurantHours; read it from the restaurant.
	if err := r.db.QueryRow(ctx,
		`SELECT timezone FROM restaurant WHERE id = $1 AND deleted_at IS NULL`,
		restaurantID).Scan(&out.Timezone); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get hours timezone: %w", err)
	}

	rows, err := r.db.Query(ctx, `
		SELECT day_of_week, to_char(opens_at, 'HH24:MI'), to_char(closes_at, 'HH24:MI'), crosses_midnight
		  FROM restaurant_hours WHERE restaurant_id = $1 ORDER BY day_of_week`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var s HoursSlotRow
		if err := rows.Scan(&s.DayOfWeek, &s.OpensAt, &s.ClosesAt, &s.CrossesMidnight); err != nil {
			return nil, err
		}
		out.Intervals = append(out.Intervals, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	orows, err := r.db.Query(ctx, `
		SELECT on_date::text, is_closed, to_char(opens_at, 'HH24:MI'), to_char(closes_at, 'HH24:MI'), reason
		  FROM restaurant_hours_override WHERE restaurant_id = $1 ORDER BY on_date`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer orows.Close()
	for orows.Next() {
		var o HoursOverrideRow
		if err := orows.Scan(&o.Date, &o.IsClosed, &o.OpensAt, &o.ClosesAt, &o.Reason); err != nil {
			return nil, err
		}
		out.Overrides = append(out.Overrides, o)
	}
	return out, orows.Err()
}

// SetHours replaces the restaurant's trading hours (full replace, idempotent).
func (r *Repo) SetHours(ctx context.Context, restaurantID string, in hoursInputDTO) (*HoursView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Replace weekly hours.
	if _, err := tx.Exec(ctx, `DELETE FROM restaurant_hours WHERE restaurant_id = $1`, restaurantID); err != nil {
		return nil, fmt.Errorf("delete hours: %w", err)
	}
	for _, s := range in.Intervals {
		cm := false
		if s.CrossesMidnight != nil {
			cm = *s.CrossesMidnight
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)
			VALUES ($1,$2,$3::time,$4::time,$5)`,
			restaurantID, s.DayOfWeek, s.OpensAt, s.ClosesAt, cm)
		if err != nil {
			return nil, fmt.Errorf("insert hour slot: %w", err)
		}
	}

	// Replace overrides.
	if _, err := tx.Exec(ctx, `DELETE FROM restaurant_hours_override WHERE restaurant_id = $1`, restaurantID); err != nil {
		return nil, fmt.Errorf("delete overrides: %w", err)
	}
	for _, o := range in.Overrides {
		_, err := tx.Exec(ctx, `
			INSERT INTO restaurant_hours_override (restaurant_id, on_date, is_closed, opens_at, closes_at, reason)
			VALUES ($1,$2::date,$3,$4::time,$5::time,$6)`,
			restaurantID, o.Date, o.IsClosed, o.OpensAt, o.ClosesAt, o.Reason)
		if err != nil {
			return nil, fmt.Errorf("insert override: %w", err)
		}
	}

	// Hours are one of the gates to ACTIVE (R-06): re-evaluate in this transaction.
	if err := RecomputeOnboarding(ctx, tx, restaurantID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetHours(ctx, restaurantID)
}

// documentColumns is the KycDocument projection of a kyc_document row aliased d,
// read by scanDocument.
const documentColumns = `
		       d.id::text, d.subject_type::text, d.subject_id::text,
		       d.restaurant_doc_type::text, d.state::text,
		       d.issuer, d.certificate_number,
		       d.issued_on::text, d.valid_until::text, d.version,
		       d.rejection_reason_code::text, d.review_note, d.reviewed_at,
		       d.created_at`

// scanDocument reads one row of documentColumns.
func scanDocument(row pgx.Row) (DocumentRow, error) {
	var d DocumentRow
	var reviewedAt *time.Time
	var createdAt time.Time
	if err := row.Scan(&d.ID, &d.SubjectType, &d.SubjectID, &d.DocType, &d.State,
		&d.Issuer, &d.CertificateNumber, &d.IssuedOn, &d.ValidUntil, &d.Version,
		&d.RejectionReasonCode, &d.ReviewNote, &reviewedAt, &createdAt); err != nil {
		return DocumentRow{}, err
	}
	d.ReviewedAt = tsStrPtr(reviewedAt)
	d.CreatedAt = tsStr(createdAt)
	return d, nil
}

// ListDocuments returns all KYC documents for the restaurant.
func (r *Repo) ListDocuments(ctx context.Context, restaurantID string) ([]DocumentRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT `+documentColumns+`
		  FROM kyc_document d
		 WHERE d.subject_id = $1 AND d.subject_type = 'RESTAURANT'
		   AND d.deleted_at IS NULL
		 ORDER BY d.created_at DESC`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocumentRow
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	if out == nil {
		out = []DocumentRow{}
	}
	return out, rows.Err()
}

// AttachDocument attaches one kyc_document to the restaurant (R-07). When the
// document is a HALAL_CERTIFICATE it also creates the first-class
// halal_certificate entity the seven-check verification instrument acts on, in
// the same transaction as the document row: a halal claim is not a document
// with a yes/no toggle. The certificate is created PENDING, seeded with the
// attach-time facts (issuing body, certificate number, dates) and prefilled
// with the restaurant's own legal name/address as a starting point the admin
// re-transcribes and independently confirms via checks H3/H4. `scope` defaults
// to SPECIFIC_MENU_ITEMS — which FAILS H6 — so nothing accidentally passes: the
// admin must transcribe the real scope before approval is possible.
//
// Re-attaching HALAL_CERTIFICATE supersedes the prior PENDING certificate rather
// than mutating it; full history is retained.
//
// The file must be the caller's own confirmed compliance upload, not yet
// attached to anyone else (claimComplianceUpload); anything else is
// ErrUploadNotFound and nothing is written. A download link is granted to
// whoever owns the document, so attaching another account's file would hand
// its bytes to this restaurant
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
//
// One file is attached once per document type. When a live row for the same
// (restaurant, doc_type, file) exists, that row is returned and nothing is
// written: no second review item, and no second halal certificate superseding
// the first. The database holds the rule (unique index
// kyc_document_restaurant_file_once, migration 00051), so two attaches of the
// same file at once cannot both insert
// (https://github.com/shaiknoorullah/hg-mono/issues/360).
func (r *Repo) AttachDocument(ctx context.Context, accountID, restaurantID string, in documentInputDTO) (*DocumentRow, error) {
	isHalal := in.DocType == "HALAL_CERTIFICATE"

	// A halal certificate must name a registry issuing body, a certificate number
	// and an expiry. A halal claim with no issuing body is unverifiable.
	if isHalal {
		if in.IssuerBodyID == nil || *in.IssuerBodyID == "" ||
			in.CertificateNumber == nil || *in.CertificateNumber == "" ||
			in.ValidUntil == nil || *in.ValidUntil == "" {
			return nil, ErrHalalCertMissingFields
		}
	}
	// An already-expired certificate/document is refused at attach time, not
	// discovered at review time.
	if in.ValidUntil != nil && *in.ValidUntil != "" {
		if vu, perr := time.Parse("2006-01-02", *in.ValidUntil); perr == nil {
			if vu.Before(time.Now().Truncate(24 * time.Hour)) {
				return nil, ErrDocumentAlreadyExpired
			}
		}
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := claimComplianceUpload(ctx, tx, accountID, restaurantID, in.StoredObjectID); err != nil {
		return nil, err
	}

	// The conflict target names the partial index's predicate so Postgres
	// matches kyc_document_restaurant_file_once.
	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id,
			issuer, halal_issuing_body_id, certificate_number, issued_on, valid_until,
			state, deadline_at, deadline_action)
		VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3,
			$4, $5::uuid, $6, $7::date, $8::date,
			'SUBMITTED', now()+interval '72h', 'ESCALATE')
		ON CONFLICT (subject_id, restaurant_doc_type, stored_object_id)
		   WHERE subject_type = 'RESTAURANT' AND deleted_at IS NULL
		   DO NOTHING
		RETURNING id::text`,
		restaurantID, in.DocType, in.StoredObjectID,
		in.Issuer, in.IssuerBodyID, in.CertificateNumber, in.IssuedOn, in.ValidUntil).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Already attached as this type: hand back that document. A separate
		// statement, so it sees a row a concurrent attach committed after the
		// INSERT began.
		if err := tx.QueryRow(ctx, `
			SELECT id::text FROM kyc_document
			 WHERE subject_type = 'RESTAURANT' AND subject_id = $1
			   AND restaurant_doc_type = $2::restaurant_doc_type AND stored_object_id = $3
			   AND deleted_at IS NULL`,
			restaurantID, in.DocType, in.StoredObjectID).Scan(&id); err != nil {
			return nil, fmt.Errorf("read attached document: %w", err)
		}
	case err != nil:
		return nil, fmt.Errorf("attach document: %w", err)
	case isHalal:
		if err := r.createHalalCertificateTx(ctx, tx, restaurantID, id, in); err != nil {
			return nil, err
		}
	}

	doc, err := scanDocument(tx.QueryRow(ctx, `SELECT `+documentColumns+` FROM kyc_document d WHERE d.id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("read attached document: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &doc, nil
}

// claimComplianceUpload checks that objectID is a file the caller may attach as
// one of this restaurant's compliance documents, and locks it for the rest of
// the attach transaction. The file must be:
//
//   - uploaded by the caller. A compliance upload records no restaurant (the
//     upload keys it under the account), so the uploader is the one fact that
//     ties it to this attach, and the rule matches the rider attach;
//   - confirmed (READY) and not deleted, so an unverified upload never reaches
//     review;
//   - uploaded as a KYC_DOCUMENT, into the private compliance bucket;
//   - not attached to another subject's documents. One upload backs one
//     subject's documents; attaching it again to this restaurant is the
//     idempotent case the caller handles.
//
// Anything else is ErrUploadNotFound
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func claimComplianceUpload(ctx context.Context, tx pgx.Tx, accountID, restaurantID, objectID string) error {
	// The row lock makes two attaches of one file take turns, so the check
	// below sees the other attach's committed row.
	var ok bool
	err := tx.QueryRow(ctx, `
		SELECT true FROM stored_object
		 WHERE id = $1 AND uploaded_by = $2
		   AND purpose = 'KYC_DOCUMENT' AND state = 'READY' AND deleted_at IS NULL
		   FOR NO KEY UPDATE`, objectID, accountID).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUploadNotFound
	}
	if err != nil {
		return fmt.Errorf("check upload: %w", err)
	}
	// A separate statement, so its snapshot is taken after the lock is held.
	var elsewhere bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM kyc_document
		   WHERE stored_object_id = $1 AND deleted_at IS NULL
		     AND (subject_type <> 'RESTAURANT' OR subject_id <> $2))`,
		objectID, restaurantID).Scan(&elsewhere); err != nil {
		return fmt.Errorf("check upload is unattached: %w", err)
	}
	if elsewhere {
		return ErrUploadNotFound
	}
	return nil
}

// halalChecklistVersion is the closed seven-check list version at V0 (A-15). It
// mirrors admin.HalalChecklistVersion; the restaurant package seeds it onto a
// new certificate row so the version is set from creation.
const halalChecklistVersion = 1

// createHalalCertificateTx creates a PENDING halal_certificate for a just-attached
// HALAL_CERTIFICATE document, superseding any prior PENDING certificate for the
// restaurant. It runs inside the attach transaction.
func (r *Repo) createHalalCertificateTx(ctx context.Context, tx pgx.Tx, restaurantID, documentID string, in documentInputDTO) error {
	// The issuing body must exist in the registry — free text / an unknown body
	// is what makes a halal claim unverifiable (R-07).
	var bodyExists bool
	if err := tx.QueryRow(ctx,
		`SELECT true FROM halal_issuing_body WHERE id=$1 AND deleted_at IS NULL`,
		*in.IssuerBodyID).Scan(&bodyExists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUnrecognisedCertifier
		}
		return fmt.Errorf("lookup issuing body: %w", err)
	}

	// Prefill the certified name/address from the restaurant's own profile as a
	// starting point; the admin re-transcribes and independently confirms H3/H4.
	var legalName string
	var line1, line2, city, province, postal *string
	if err := tx.QueryRow(ctx, `
		SELECT legal_name, line1, line2, city, province::text, postal_code
		  FROM restaurant WHERE id=$1`, restaurantID).Scan(
		&legalName, &line1, &line2, &city, &province, &postal); err != nil {
		return fmt.Errorf("lookup restaurant for certificate: %w", err)
	}
	certifiedAddress := composeAddress(line1, line2, city, province, postal)

	// issued_on defaults to today when the restaurant did not print one; the
	// admin corrects it at transcription. expires_on is the certificate's
	// valid_until (already validated as future above).
	args := []any{restaurantID, documentID, *in.CertificateNumber, *in.IssuerBodyID,
		legalName, certifiedAddress, *in.ValidUntil, halalChecklistVersion}
	var issuedExpr string
	if in.IssuedOn != nil && *in.IssuedOn != "" {
		issuedExpr = "$9::date"
		args = append(args, *in.IssuedOn)
	} else {
		issuedExpr = "CURRENT_DATE"
	}

	// Supersede any prior PENDING certificate for this restaurant.
	if _, err := tx.Exec(ctx, `
		UPDATE halal_certificate SET status='SUPERSEDED', updated_at=now()
		 WHERE restaurant_id=$1 AND status='PENDING' AND deleted_at IS NULL`,
		restaurantID); err != nil {
		return fmt.Errorf("supersede prior certificate: %w", err)
	}

	// scope SPECIFIC_MENU_ITEMS FAILS H6 by construction, so a certificate can
	// never pass approval on placeholder data — the admin must transcribe the
	// real scope. status PENDING, checks all NOT_ASSESSED until the admin acts.
	sql := `
		INSERT INTO halal_certificate
			(restaurant_id, document_id, certificate_number, issuing_body_id,
			 certified_legal_name, certified_address, scope, issued_on, expires_on,
			 status, checklist_version)
		VALUES ($1, $2, $3, $4::uuid, $5, $6, 'SPECIFIC_MENU_ITEMS',
			` + issuedExpr + `, $7::date, 'PENDING', $8)`
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		return fmt.Errorf("create halal certificate: %w", err)
	}
	return nil
}

// composeAddress joins the parts of a Canadian address into one line for the
// certified_address seed. Nil / empty parts are skipped.
func composeAddress(line1, line2, city, province, postal *string) string {
	parts := make([]string, 0, 5)
	for _, p := range []*string{line1, line2, city, province, postal} {
		if p != nil && *p != "" {
			parts = append(parts, *p)
		}
	}
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	if out == "" {
		return "Address not transcribed"
	}
	return out
}

// checkMenuImage checks that objectID, when given, may be the photo of one of
// this restaurant's menu items. The file must be a confirmed (READY), live
// MENU_IMAGE upload, and it must belong to this restaurant: uploaded by the
// caller, or by someone who holds or held a grant here, or already the photo of
// one of this restaurant's menu items (an update re-sends the current photo,
// which an admin may have uploaded). Anything else is ErrUploadNotFound, so a
// menu item can never carry another account's upload
// (https://github.com/shaiknoorullah/hg-mono/issues/359).
func checkMenuImage(ctx context.Context, tx pgx.Tx, accountID, restaurantID string, objectID *string) error {
	if objectID == nil {
		return nil
	}
	var ok bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM stored_object so
		   WHERE so.id = $1 AND so.purpose = 'MENU_IMAGE' AND so.state = 'READY' AND so.deleted_at IS NULL
		     AND (so.uploaded_by = $2
		          OR so.restaurant_id = $3
		          OR EXISTS (SELECT 1 FROM account_role ar
		                      WHERE ar.account_id = so.uploaded_by
		                        AND ar.scope_type = 'RESTAURANT' AND ar.scope_id = $3)
		          OR EXISTS (SELECT 1 FROM menu_item_version v
		                      WHERE v.image_object_id = so.id AND v.restaurant_id = $3)))`,
		*objectID, accountID, restaurantID).Scan(&ok); err != nil {
		return fmt.Errorf("check menu image: %w", err)
	}
	if !ok {
		return ErrUploadNotFound
	}
	return nil
}

// CheckDocumentPack verifies all required document types are present.
// Required (contract R-07 / R-08, RestaurantDocType): BUSINESS_LICENCE,
// HALAL_CERTIFICATE, FOOD_SAFETY, OWNER_ID.
func (r *Repo) CheckDocumentPack(ctx context.Context, restaurantID string) error {
	required := requiredRestaurantDocTypes
	for _, dt := range required {
		var count int
		err := r.db.QueryRow(ctx, `
			SELECT count(*) FROM kyc_document
			 WHERE subject_id = $1 AND subject_type = 'RESTAURANT'
			   AND restaurant_doc_type = $2 AND state NOT IN ('REJECTED') AND deleted_at IS NULL`,
			restaurantID, dt).Scan(&count)
		if err != nil {
			return err
		}
		if count == 0 {
			return ErrIncompleteDocumentPack
		}
	}
	return nil
}

// SubmitDocumentPack advances the restaurant's onboarding to DOCUMENTS_REVIEW
// once the required pack is present (CheckDocumentPack passed) and places the
// restaurant on the admin review queue (A-13). Entering the queue is the whole
// point of "submit for review": it upserts the restaurant_application row with a
// fresh submitted_at and a 72-hour SLA, and bumps the submission count on
// resubmission. Idempotent: a restaurant already IN_REVIEW keeps its existing
// submitted_at and is not re-queued.
func (r *Repo) SubmitDocumentPack(ctx context.Context, restaurantID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `
		UPDATE restaurant
		   SET onboarding_state = 'DOCUMENTS_REVIEW', updated_at = now()
		 WHERE id = $1 AND deleted_at IS NULL
		   AND onboarding_state IN ('DOCUMENTS_PENDING','DOCUMENTS_REJECTED','PROFILE_PENDING','REGISTERED','EMAIL_VERIFIED')`,
		restaurantID); err != nil {
		return fmt.Errorf("submit document pack: %w", err)
	}

	// Upsert the review-queue row. On a first submission it is created with
	// submitted_at=now(); on a resubmission after DOCUMENTS_REJECTED it is
	// re-queued with a new submitted_at, an incremented submission_count and its
	// prior decision cleared. A row that is already submitted and not yet decided
	// keeps its place (idempotent).
	if _, err := tx.Exec(ctx, `
		INSERT INTO restaurant_application
			(restaurant_id, submission_count, submitted_at, sla_due_at, address_pin_warning)
		VALUES ($1, 1, now(), now() + interval '72 hours', false)
		ON CONFLICT (restaurant_id) DO UPDATE
		SET submission_count = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL
		          OR restaurant_application.submitted_at IS NULL
		        THEN restaurant_application.submission_count + 1
		        ELSE restaurant_application.submission_count END,
		    submitted_at = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL
		          OR restaurant_application.submitted_at IS NULL
		        THEN now() ELSE restaurant_application.submitted_at END,
		    sla_due_at = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL
		          OR restaurant_application.submitted_at IS NULL
		        THEN now() + interval '72 hours' ELSE restaurant_application.sla_due_at END,
		    decision = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL THEN NULL
		        ELSE restaurant_application.decision END,
		    approve_reason_code = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL THEN NULL
		        ELSE restaurant_application.approve_reason_code END,
		    reject_reason_code = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL THEN NULL
		        ELSE restaurant_application.reject_reason_code END,
		    decided_by = CASE
		        WHEN restaurant_application.decided_at IS NOT NULL THEN NULL
		        ELSE restaurant_application.decided_by END,
		    decided_at = NULL,
		    updated_at = now()`,
		restaurantID); err != nil {
		return fmt.Errorf("enqueue application: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit submit: %w", err)
	}
	return nil
}

// GetMenu returns the restaurant's full menu (categories + items + versions).
func (r *Repo) GetMenu(ctx context.Context, restaurantID string) (*MenuView, error) {
	out := &MenuView{
		RestaurantID: restaurantID,
		Categories:   []MenuCategoryView{},
	}

	catRows, err := r.db.Query(ctx, `
		SELECT id::text, name, description, sort_order, is_active
		  FROM menu_category WHERE restaurant_id = $1 AND deleted_at IS NULL
		 ORDER BY sort_order, name`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer catRows.Close()
	for catRows.Next() {
		var c MenuCategoryView
		if err := catRows.Scan(&c.ID, &c.Name, &c.Description, &c.SortOrder, &c.IsActive); err != nil {
			return nil, err
		}
		c.Items = []MenuItemView{}
		out.Categories = append(out.Categories, c)
	}
	if err := catRows.Err(); err != nil {
		return nil, err
	}
	catRows.Close()

	// Load items for each category.
	for i := range out.Categories {
		items, err := r.loadCategoryItems(ctx, restaurantID, out.Categories[i].ID)
		if err != nil {
			return nil, err
		}
		out.Categories[i].Items = items
	}
	return out, nil
}

func (r *Repo) loadCategoryItems(ctx context.Context, restaurantID, categoryID string) ([]MenuItemView, error) {
	rows, err := r.db.Query(ctx, `
		SELECT mi.id::text, mi.category_id::text, mi.price_cents, mi.currency::text,
		       mi.availability_state::text, mi.out_of_stock_until,
		       mi.tax_category::text, mi.prep_minutes,
		       mi.sort_order, mi.live_version_id, mi.pending_version_id
		  FROM menu_item mi
		 WHERE mi.restaurant_id = $1 AND mi.category_id = $2 AND mi.deleted_at IS NULL
		 ORDER BY mi.sort_order, mi.created_at`, restaurantID, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MenuItemView
	var pending []menuItemScan
	for rows.Next() {
		var item MenuItemView
		var outOfStock *time.Time
		var liveVid, pendingVid *string
		if err := rows.Scan(&item.ID, &item.CategoryID, &item.PriceCents, &item.Currency,
			&item.AvailabilityState, &outOfStock,
			&item.TaxCategory, &item.PrepMinutes,
			&item.SortOrder, &liveVid, &pendingVid); err != nil {
			return nil, err
		}
		if outOfStock != nil {
			s := tsStr(*outOfStock)
			item.OutOfStockUntil = &s
		}
		pending = append(pending, menuItemScan{item: item, liveVid: liveVid, pendingVid: pendingVid})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	for _, ps := range pending {
		item := ps.item
		r.hydrateMenuItem(ctx, &item, ps.liveVid, ps.pendingVid)
		out = append(out, item)
	}
	if out == nil {
		out = []MenuItemView{}
	}
	return out, nil
}

// menuItemScan holds a partially-read item plus its version ids so versions can
// be loaded after the parent rows cursor is closed.
type menuItemScan struct {
	item       MenuItemView
	liveVid    *string
	pendingVid *string
}

// hydrateMenuItem loads live/pending versions and copies the claim-bearing
// display fields (name, description, tags, image) from the live version to the
// item so the contract's MenuItem base fields (name, tax_category, …) are populated.
func (r *Repo) hydrateMenuItem(ctx context.Context, item *MenuItemView, liveVid, pendingVid *string) {
	item.DietaryTags = []string{}
	item.AllergenTags = []string{}
	if liveVid != nil {
		if v, err := r.loadItemVersion(ctx, *liveVid); err == nil {
			item.LiveVersion = v
			item.Name = v.Name
			item.Description = v.Description
			item.IngredientsText = v.IngredientsText
			item.DietaryTags = v.DietaryTags
			item.AllergenTags = v.AllergenTags
		}
	}
	if pendingVid != nil {
		if v, err := r.loadItemVersion(ctx, *pendingVid); err == nil {
			item.PendingVersion = v
		}
	}
}

func (r *Repo) loadItemVersion(ctx context.Context, versionID string) (*MenuItemVersion, error) {
	var v MenuItemVersion
	var restaurantID string
	var createdAt time.Time
	err := r.db.QueryRow(ctx, `
		SELECT id::text, menu_item_id::text, restaurant_id::text, version, name,
		       description, ingredients_text,
		       dietary_tags::text[], allergen_tags::text[],
		       review_status::text, created_at
		  FROM menu_item_version WHERE id = $1`, versionID).Scan(
		&v.ID, &v.MenuItemID, &restaurantID, &v.Version, &v.Name, &v.Description, &v.IngredientsText,
		&v.DietaryTags, &v.AllergenTags,
		&v.ReviewStatus, &createdAt)
	if err != nil {
		return nil, err
	}
	v.RestaurantID = &restaurantID
	if v.DietaryTags == nil {
		v.DietaryTags = []string{}
	}
	if v.AllergenTags == nil {
		v.AllergenTags = []string{}
	}
	v.CreatedAt = tsStr(createdAt)
	return &v, nil
}

// CreateCategory creates a new menu category and returns its view.
// Returns ErrCategoryNameTaken if a category with the same name exists, and
// ErrMenuLocked while the restaurant is suspended or banned (menu_lock.go).
func (r *Repo) CreateCategory(ctx context.Context, restaurantID string, in categoryInputDTO) (*MenuCategoryView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := LockMenuForWrite(ctx, tx, restaurantID); err != nil {
		return nil, err
	}

	var id string
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name, description, sort_order)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text`,
		restaurantID, in.Name, in.Description, sortOrder).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrCategoryNameTaken
		}
		return nil, fmt.Errorf("create category: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &MenuCategoryView{
		ID:          id,
		Name:        in.Name,
		Description: in.Description,
		SortOrder:   sortOrder,
		IsActive:    true,
		Items:       []MenuItemView{},
	}, nil
}

// UpdateCategory renames, reorders, deactivates or reactivates one of the
// restaurant's categories (updateMenuCategory, R-14). Every field is optional.
// A new sort_order moves the category to that position, and the restaurant's
// categories are rewritten as a dense 0..n-1 sequence in the same transaction.
// Returns ErrNotFound when the category is not on this restaurant's menu,
// ErrCategoryNameTaken for a name another of its categories uses (ignoring
// case), and ErrMenuLocked while the restaurant is suspended or banned.
func (r *Repo) UpdateCategory(ctx context.Context, restaurantID, categoryID string, in categoryUpdateDTO) (*MenuCategoryView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := LockMenuForWrite(ctx, tx, restaurantID); err != nil {
		return nil, err
	}

	// Lock every category of the menu, in id order, so two reorders of the same
	// menu queue behind each other instead of interleaving their rewrites.
	if _, err := tx.Exec(ctx, `
		SELECT 1 FROM menu_category
		 WHERE restaurant_id = $1 AND deleted_at IS NULL
		 ORDER BY id FOR UPDATE`, restaurantID); err != nil {
		return nil, fmt.Errorf("lock categories: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE menu_category
		   SET name        = COALESCE($3, name),
		       description = COALESCE($4, description),
		       is_active   = COALESCE($5, is_active)
		 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL`,
		categoryID, restaurantID, in.Name, in.Description, in.IsActive)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrCategoryNameTaken
		}
		return nil, fmt.Errorf("update category: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}

	if in.SortOrder != nil {
		if err := moveCategory(ctx, tx, restaurantID, categoryID, *in.SortOrder); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	var c MenuCategoryView
	if err := r.db.QueryRow(ctx, `
		SELECT id::text, name, description, sort_order, is_active
		  FROM menu_category WHERE id = $1`, categoryID).Scan(
		&c.ID, &c.Name, &c.Description, &c.SortOrder, &c.IsActive); err != nil {
		return nil, err
	}
	if c.Items, err = r.loadCategoryItems(ctx, restaurantID, categoryID); err != nil {
		return nil, err
	}
	return &c, nil
}

// moveCategory puts the category at position (clamped to the menu) in the order
// the menu is shown in (sort_order, then name), and rewrites sort_order for the
// restaurant's categories as the dense sequence 0..n-1. The caller holds the
// categories' row locks.
func moveCategory(ctx context.Context, tx pgx.Tx, restaurantID, categoryID string, position int) error {
	rows, err := tx.Query(ctx, `
		SELECT id::text FROM menu_category
		 WHERE restaurant_id = $1 AND deleted_at IS NULL
		 ORDER BY sort_order, name, id`, restaurantID)
	if err != nil {
		return fmt.Errorf("read category order: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("read category order: %w", err)
	}
	order := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != categoryID {
			order = append(order, id)
		}
	}
	position = max(0, min(position, len(order)))
	order = append(order[:position], append([]string{categoryID}, order[position:]...)...)
	if _, err := tx.Exec(ctx, `
		UPDATE menu_category c SET sort_order = o.ord - 1
		  FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord)
		 WHERE c.id = o.id AND c.sort_order <> o.ord - 1`, order); err != nil {
		return fmt.Errorf("rewrite category order: %w", err)
	}
	return nil
}

// CreateMenuItem creates a new menu item + initial DRAFT version.
// The version is always DRAFT (never auto-approved per R-05 / halal gate).
func (r *Repo) CreateMenuItem(ctx context.Context, accountID, restaurantID string, in menuItemInputDTO) (*MenuItemView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ErrMenuLocked while the restaurant is suspended or banned (menu_lock.go).
	if err := LockMenuForWrite(ctx, tx, restaurantID); err != nil {
		return nil, err
	}
	if err := checkMenuImage(ctx, tx, accountID, restaurantID, in.ImageObjectID); err != nil {
		return nil, err
	}

	// IDOR guard: the target category must belong to THIS restaurant. The FK on
	// menu_item.category_id references menu_category(id) globally, so without this
	// check a caller could attach an item to another tenant's category. A
	// foreign or non-existent category is indistinguishable → 404 (never 403).
	var ownedCat bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM menu_category
		 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL)`,
		in.CategoryID, restaurantID).Scan(&ownedCat); err != nil {
		return nil, fmt.Errorf("verify category ownership: %w", err)
	}
	if !ownedCat {
		return nil, ErrNotFound
	}

	var itemID string
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, sort_order, tax_category, prep_minutes)
		VALUES ($1, $2::uuid, $3, $4, 'PREPARED_FOOD', $5)
		RETURNING id::text`,
		restaurantID, in.CategoryID, in.PriceCents, sortOrder, in.PrepMinutes).Scan(&itemID)
	if err != nil {
		return nil, fmt.Errorf("create menu_item: %w", err)
	}

	dietaryTags := in.DietaryTags
	if dietaryTags == nil {
		dietaryTags = []string{}
	}
	allergenTags := in.AllergenTags
	if allergenTags == nil {
		allergenTags = []string{}
	}

	allergensDeclared := false
	if in.AllergensDeclared != nil {
		allergensDeclared = *in.AllergensDeclared
	}

	var versionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_item_version
			(menu_item_id, restaurant_id, version, name, description, ingredients_text,
			 dietary_tags, allergen_tags, allergens_declared, image_object_id, review_status)
		VALUES ($1, $2, 1, $3, $4, $5,
		        $6::dietary_tag[], $7::allergen_tag[], $8, $9::uuid, 'DRAFT')
		RETURNING id::text`,
		itemID, restaurantID, in.Name, in.Description, in.IngredientsText,
		dietaryTags, allergenTags, allergensDeclared, in.ImageObjectID).Scan(&versionID)
	if err != nil {
		return nil, fmt.Errorf("create menu_item_version: %w", err)
	}

	// Set both live_version_id and pending_version_id to the draft (R-05:
	// never auto-approved; live_version_id makes the item queryable,
	// pending_version_id signals it is awaiting review).
	if _, err := tx.Exec(ctx, `UPDATE menu_item SET live_version_id=$1, pending_version_id=$1 WHERE id=$2`,
		versionID, itemID); err != nil {
		return nil, fmt.Errorf("set live_version_id: %w", err)
	}

	// A live item is one of the gates to ACTIVE (R-17): re-evaluate in this transaction.
	if err := RecomputeOnboarding(ctx, tx, restaurantID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return r.getMenuItemByID(ctx, restaurantID, itemID)
}

// UpdateMenuItem creates a new PENDING_REVIEW version for an existing item
// (or DRAFT when carrying halal-bearing tags). Validates ownership.
func (r *Repo) UpdateMenuItem(ctx context.Context, accountID, restaurantID, itemID string, in menuItemUpdateDTO) (*MenuItemView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ErrMenuLocked while the restaurant is suspended or banned (menu_lock.go): no
	// price, photo or other field changes, and a version waiting for review stays.
	if err := LockMenuForWrite(ctx, tx, restaurantID); err != nil {
		return nil, err
	}
	if err := checkMenuImage(ctx, tx, accountID, restaurantID, in.ImageObjectID); err != nil {
		return nil, err
	}

	// Load current item (ownership check in WHERE clause).
	var currentCategoryID string
	var currentPrice int64
	var currentVersionNo int
	var currentLiveVersionID *string
	err = tx.QueryRow(ctx, `
		SELECT mi.category_id::text, mi.price_cents,
		       COALESCE(miv.version, 0), mi.live_version_id::text
		  FROM menu_item mi
		  LEFT JOIN menu_item_version miv ON miv.id = mi.live_version_id
		 WHERE mi.id = $1 AND mi.restaurant_id = $2 AND mi.deleted_at IS NULL`,
		itemID, restaurantID).Scan(&currentCategoryID, &currentPrice, &currentVersionNo, &currentLiveVersionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load menu_item for update: %w", err)
	}

	// Apply price + category updates to the item row.
	if in.PriceCents != nil {
		if _, err := tx.Exec(ctx, `UPDATE menu_item SET price_cents=$1, updated_at=now() WHERE id=$2`,
			*in.PriceCents, itemID); err != nil {
			return nil, fmt.Errorf("update price: %w", err)
		}
	}
	if in.CategoryID != nil {
		// IDOR guard: the destination category must belong to THIS restaurant.
		var ownedCat bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM menu_category
			 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL)`,
			*in.CategoryID, restaurantID).Scan(&ownedCat); err != nil {
			return nil, fmt.Errorf("verify category ownership: %w", err)
		}
		if !ownedCat {
			return nil, ErrNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE menu_item SET category_id=$1::uuid, updated_at=now() WHERE id=$2`,
			*in.CategoryID, itemID); err != nil {
			return nil, fmt.Errorf("update category: %w", err)
		}
	}
	if in.PrepMinutes != nil {
		if _, err := tx.Exec(ctx, `UPDATE menu_item SET prep_minutes=$1, updated_at=now() WHERE id=$2`,
			*in.PrepMinutes, itemID); err != nil {
			return nil, fmt.Errorf("update prep_minutes: %w", err)
		}
	}

	// Create a new version for the claim-bearing descriptive fields.
	newVersion := currentVersionNo + 1
	name := ""
	if currentLiveVersionID != nil {
		// Inherit from live.
		_ = tx.QueryRow(ctx, `SELECT name FROM menu_item_version WHERE id=$1`, *currentLiveVersionID).Scan(&name)
	}
	if in.Name != nil {
		name = *in.Name
	}
	if name == "" {
		name = "Unnamed"
	}

	dietaryTags := in.DietaryTags
	if dietaryTags == nil {
		dietaryTags = []string{}
	}
	allergenTags := in.AllergenTags
	if allergenTags == nil {
		allergenTags = []string{}
	}

	allergensDeclared := false
	if in.AllergensDeclared != nil {
		allergensDeclared = *in.AllergensDeclared
	}

	var newVersionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_item_version
			(menu_item_id, restaurant_id, version, name, description, ingredients_text,
			 dietary_tags, allergen_tags, allergens_declared, image_object_id, review_status)
		VALUES ($1, $2, $3, $4, $5, $6,
		        $7::dietary_tag[], $8::allergen_tag[], $9, $10::uuid, 'DRAFT')
		RETURNING id::text`,
		itemID, restaurantID, newVersion, name, in.Description, in.IngredientsText,
		dietaryTags, allergenTags, allergensDeclared, in.ImageObjectID).Scan(&newVersionID)
	if err != nil {
		return nil, fmt.Errorf("create updated version: %w", err)
	}

	// Point live_version_id at the new draft so the item appears with the new name.
	if _, err := tx.Exec(ctx, `UPDATE menu_item SET live_version_id=$1, updated_at=now() WHERE id=$2`,
		newVersionID, itemID); err != nil {
		return nil, fmt.Errorf("set live_version: %w", err)
	}

	if err := RecomputeOnboarding(ctx, tx, restaurantID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.getMenuItemByID(ctx, restaurantID, itemID)
}

// SetMenuItemAvailability sets a menu item's availability state. Validates ownership.
// ErrMenuLocked while the restaurant is suspended or banned (menu_lock.go): an item
// cannot be marked out of stock or back in stock.
func (r *Repo) SetMenuItemAvailability(ctx context.Context, restaurantID, itemID string, in availabilityInputDTO) (*MenuItemView, error) {
	// availability_state is the contract enum [AVAILABLE, OUT_OF_STOCK]; the
	// handler validates it before we reach the ::menu_item_availability_state cast.
	state := in.AvailabilityState

	var outUntil *time.Time
	if in.OutOfStockUntil != nil {
		t, err := time.Parse(time.RFC3339, *in.OutOfStockUntil)
		if err == nil {
			outUntil = &t
		}
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := LockMenuForWrite(ctx, tx, restaurantID); err != nil {
		return nil, err
	}

	tag, err := tx.Exec(ctx, `
		UPDATE menu_item SET availability_state=$2::menu_item_availability_state,
		       out_of_stock_until=$3, updated_at=now()
		 WHERE id=$1 AND restaurant_id=$4 AND deleted_at IS NULL`,
		itemID, state, outUntil, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("set availability: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.getMenuItemByID(ctx, restaurantID, itemID)
}

// getMenuItemByID loads a single menu item (with versions) owned by the restaurant.
func (r *Repo) getMenuItemByID(ctx context.Context, restaurantID, itemID string) (*MenuItemView, error) {
	var item MenuItemView
	var outOfStock *time.Time
	var liveVid, pendingVid *string
	err := r.db.QueryRow(ctx, `
		SELECT mi.id::text, mi.category_id::text, mi.price_cents, mi.currency::text,
		       mi.availability_state::text, mi.out_of_stock_until,
		       mi.tax_category::text, mi.prep_minutes,
		       mi.sort_order, mi.live_version_id::text, mi.pending_version_id::text
		  FROM menu_item mi
		 WHERE mi.id = $1 AND mi.restaurant_id = $2 AND mi.deleted_at IS NULL`,
		itemID, restaurantID).Scan(
		&item.ID, &item.CategoryID, &item.PriceCents, &item.Currency,
		&item.AvailabilityState, &outOfStock,
		&item.TaxCategory, &item.PrepMinutes,
		&item.SortOrder, &liveVid, &pendingVid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if outOfStock != nil {
		s := tsStr(*outOfStock)
		item.OutOfStockUntil = &s
	}
	r.hydrateMenuItem(ctx, &item, liveVid, pendingVid)
	return &item, nil
}

// ListOrders returns the restaurant's orders, paginated (newest first).
// Each item is the full OrderRestaurantView (the same shape as GetOrder).
func (r *Repo) ListOrders(ctx context.Context, restaurantID string, limit int, afterID *string) ([]OrderRestaurantView, bool, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	args := []any{restaurantID}
	where := `restaurant_id = $1`
	if afterID != nil {
		args = append(args, *afterID)
		where += fmt.Sprintf(` AND placed_at < (SELECT placed_at FROM "order" WHERE id=$%d)`, len(args))
	}
	args = append(args, limit+1)
	q := fmt.Sprintf(`
		SELECT id::text
		  FROM "order"
		 WHERE %s
		 ORDER BY placed_at DESC LIMIT $%d`, where, len(args))

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	rows.Close()

	hasMore := len(ids) > limit
	if hasMore {
		ids = ids[:limit]
	}

	out := make([]OrderRestaurantView, 0, len(ids))
	for _, id := range ids {
		v, err := r.GetOrder(ctx, restaurantID, id)
		if err != nil {
			return nil, false, err
		}
		out = append(out, *v)
	}
	return out, hasMore, nil
}

// GetOrder returns a restaurant's order by ID (ownership enforced in SQL).
// It is the ONE mapper to the contract OrderRestaurantView: nested money
// (RestaurantOrderMoney), nested customer (OrderCustomerRef), lines[] (OrderLine).
func (r *Repo) GetOrder(ctx context.Context, restaurantID, orderID string) (*OrderRestaurantView, error) {
	var o OrderRestaurantView
	var money RestaurantOrderMoney
	var discountCents int64
	var placedAt time.Time
	var deadlineAt, promisedReadyAt, acceptedAt, readyAt *time.Time
	// Customer (P-07 minimised): first name + last initial, masked phone.
	var custFirst *string
	var custLast *string
	var custPhone *string
	// Delivery area: city + distance band. City is available on the address.
	var city *string
	err := r.db.QueryRow(ctx, `
		SELECT o.id::text, o.code, o.state::text, o.state_since, o.deadline_at,
		       o.promised_ready_at,
		       o.subtotal_cents, o.discount_cents, o.commission_cents,
		       o.restaurant_net_cents, o.total_cents, o.currency::text,
		       o.placed_at, o.accepted_at, o.ready_at, o.special_instructions,
		       cp.first_name, cp.last_name, acc.phone_e164,
		       addr.city
		  FROM "order" o
		  LEFT JOIN account acc ON acc.id = o.account_id
		  LEFT JOIN customer_profile cp ON cp.account_id = o.account_id
		  LEFT JOIN address addr ON addr.id = o.delivery_address_id
		 WHERE o.id = $1 AND o.restaurant_id = $2`,
		orderID, restaurantID).Scan(
		&o.ID, &o.Code, &o.State, new(time.Time), &deadlineAt,
		&promisedReadyAt,
		&money.SubtotalCents, &discountCents, &money.CommissionCents,
		&money.RestaurantNetCents, &money.TotalCents, &money.Currency,
		&placedAt, &acceptedAt, &readyAt, &o.SpecialInstructions,
		&custFirst, &custLast, &custPhone,
		&city)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get order: %w", err)
	}
	if discountCents != 0 {
		o.Money = money
		o.Money.DiscountCents = &discountCents
	} else {
		o.Money = money
	}
	o.PlacedAt = tsStr(placedAt)
	o.DeadlineAt = tsStrPtr(deadlineAt)
	o.PromisedReadyAt = tsStrPtr(promisedReadyAt)
	o.AcceptedAt = tsStrPtr(acceptedAt)
	o.ReadyAt = tsStrPtr(readyAt)
	o.Customer = OrderCustomerRef{
		DisplayName: customerDisplayName(custFirst, custLast),
		PhoneMasked: maskPhone(custPhone),
	}
	if city != nil && *city != "" {
		da := *city
		o.DeliveryArea = &da
	}
	// is_late: past deadline while still non-terminal.
	if deadlineAt != nil {
		late := time.Now().After(*deadlineAt)
		o.IsLate = &late
	}

	// Lines.
	lRows, err := r.db.Query(ctx, `
		SELECT line_no, menu_item_id::text, name_snapshot, variant_name, quantity,
		       line_unit_cents, line_total_cents, special_request
		  FROM order_line WHERE order_id = $1 ORDER BY line_no`, orderID)
	if err != nil {
		return nil, err
	}
	defer lRows.Close()
	for lRows.Next() {
		var l OrderLineView
		if err := lRows.Scan(&l.LineNo, &l.MenuItemID, &l.Name, &l.VariantName, &l.Quantity,
			&l.UnitPriceCents, &l.LineTotalCents, &l.SpecialRequest); err != nil {
			return nil, err
		}
		// OrderLine.currency is the order's currency (contract Currency, required).
		l.Currency = o.Money.Currency
		o.Lines = append(o.Lines, l)
	}
	if o.Lines == nil {
		o.Lines = []OrderLineView{}
	}
	return &o, lRows.Err()
}

// customerDisplayName renders "Aisha K." — first name plus last initial (P-07).
func customerDisplayName(first, last *string) string {
	name := ""
	if first != nil {
		name = *first
	}
	if last != nil && *last != "" {
		r := []rune(*last)
		name = name + " " + string(r[0]) + "."
	}
	if name == "" {
		return "Customer"
	}
	return name
}

// maskPhone renders "+1 416 ••• 0123" — full phone is never exposed (P-07).
func maskPhone(p *string) string {
	if p == nil || len(*p) < 4 {
		return "•••"
	}
	digits := []rune(*p)
	last4 := string(digits[len(digits)-4:])
	return "••• " + last4
}

// AcceptOrder transitions RESTAURANT_PENDING → PREPARING.
// Returns orders.ErrRestaurantUnavailable if the restaurant cannot take orders
// now; ErrOfferExpired if the deadline has passed; ErrIllegalTransition if the
// order is not in RESTAURANT_PENDING.
func (r *Repo) AcceptOrder(ctx context.Context, restaurantID, orderID, actorAccountID string, promisedReadyMinutes *int) (*OrderRestaurantView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// A restaurant that is not LIVE, or whose halal certificate is not current
	// now, cannot take an order by accepting one either. The order stays
	// RESTAURANT_PENDING until its deadline cancels it and releases the
	// authorisation, so nothing is captured. The restaurant row is locked FOR
	// SHARE before the order is locked FOR UPDATE, the same order an
	// account-state action takes, so a suspension either committed first and
	// is refused here, or waits for this accept and then settles the PREPARING
	// order. https://github.com/shaiknoorullah/hg-mono/issues/328
	if err := orders.LockOrderableRestaurant(ctx, tx, restaurantID); err != nil {
		return nil, err
	}

	var state string
	var deadlineAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT state::text, deadline_at FROM "order"
		 WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state, &deadlineAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "RESTAURANT_PENDING" {
		return nil, ErrIllegalTransition
	}
	if deadlineAt != nil && time.Now().After(*deadlineAt) {
		return nil, ErrOfferExpired
	}

	// The transition function arms the PREPARING deadline from the prep ETA
	// (accepted_at + prep ETA + 10 minutes, PREP_OVERDUE).
	prepMins := 30
	if promisedReadyMinutes != nil {
		prepMins = *promisedReadyMinutes
	}

	var promisedReadyAt *time.Time
	if promisedReadyMinutes != nil {
		t := time.Now().UTC().Add(time.Duration(*promisedReadyMinutes) * time.Minute)
		promisedReadyAt = &t
	}

	// The prep ETA and promised ready time are the restaurant's own columns;
	// they commit in the transition's transaction, after the state change.
	recordPrep := func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			UPDATE "order" SET promised_ready_at=$2, prep_eta_minutes=$3 WHERE id=$1`,
			orderID, promisedReadyAt, prepMins); err != nil {
			return fmt.Errorf("record prep eta: %w", err)
		}
		return nil
	}
	if err := r.acceptTx(ctx, tx, orderID, actorAccountID, prepMins, recordPrep); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// RejectOrder transitions RESTAURANT_PENDING → REJECTED.
func (r *Repo) RejectOrder(ctx context.Context, restaurantID, orderID, actorAccountID, reason string, note *string) (*OrderRestaurantView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var state string
	err = tx.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "RESTAURANT_PENDING" {
		return nil, ErrIllegalTransition
	}

	// REJECTED is its own terminal state with its own reject_reason. It is NOT
	// CANCELLED, so cancel_reason must stay NULL (there is no RESTAURANT_REJECTED
	// member of order_cancellation_reason_code; setting it 22P02'd → 500 on every
	// real rejection). The CHECK order_reject_has_reason is satisfied by
	// reject_reason alone. The transition function clears the deadline.
	if err := r.rejectTx(ctx, tx, orderID, actorAccountID, reason, note); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// MarkOrderReady transitions PREPARING → READY_FOR_PICKUP.
func (r *Repo) MarkOrderReady(ctx context.Context, restaurantID, orderID, actorAccountID string) (*OrderRestaurantView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var state string
	err = tx.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "PREPARING" {
		return nil, ErrIllegalTransition
	}

	// READY_FOR_PICKUP takes its deadline from the deadline table (readyTx).
	if err := r.readyTx(ctx, tx, orderID, actorAccountID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// DelayOrder adds a delay event to a PREPARING order.
// R-26: max 3 delays total. Returns ErrDelayLimitReached when exhausted.
// The order must have been accepted via AcceptOrder (accepted_at IS NOT NULL)
// to be delayable; directly-seeded PREPARING orders without accepted_at will
// also fail with ErrDelayLimitReached since they represent an inconsistent state.
func (r *Repo) DelayOrder(ctx context.Context, restaurantID, orderID, actorAccountID string, delayMinutes int, reason string) (*OrderRestaurantView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Ownership first: the order must be this restaurant's.
	var exists bool
	err = tx.QueryRow(ctx, `SELECT true FROM "order" WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	// The orders module checks the limits (R-26: at most 3 delays and 45
	// minutes in total), moves the deadline, logs the delay and tells the
	// customer, in this transaction
	// (https://github.com/shaiknoorullah/hg-mono/issues/351).
	err = r.orders.DelayInTx(ctx, tx, orders.DelayRequest{
		OrderID:        orderID,
		AddedMinutes:   delayMinutes,
		ReasonCode:     reason,
		ActorAccountID: actorAccountID,
	})
	var illegal *orders.IllegalTransitionError
	switch {
	case errors.As(err, &illegal):
		return nil, ErrIllegalTransition
	case errors.Is(err, orders.ErrDelayLimitReached):
		return nil, ErrDelayLimitReached
	case errors.Is(err, orders.ErrOrderNotFound):
		return nil, ErrNotFound
	case err != nil:
		return nil, fmt.Errorf("delay order: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// isUniqueViolation checks if a pgx error is a unique constraint violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return contains(err.Error(), "unique") || contains(err.Error(), "UNIQUE") || contains(err.Error(), "23505")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
