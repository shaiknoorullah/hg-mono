package addresses

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repo is the database access layer for the addresses package.
// All queries scope to the caller's account_id (P-07 / IDOR).
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo backed by the given connection pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// addressRow is the DB scan target, matching address table columns plus
// ST_Y/ST_X for lat/lng from the geography column.
type addressRow struct {
	ID            string
	Label         *string
	Line1         string
	Line2         *string
	Unit          *string
	Buzzer        *string
	City          string
	Province      string
	PostalCode    string
	Country       string
	Latitude      float64
	Longitude     float64
	Timezone      string
	DeliveryNotes *string
	IsDefault     bool
}

func (r addressRow) toDTO() addressDTO {
	return addressDTO{
		ID:            r.ID,
		Label:         r.Label,
		Line1:         r.Line1,
		Line2:         r.Line2,
		Unit:          r.Unit,
		Buzzer:        r.Buzzer,
		City:          r.City,
		Province:      r.Province,
		PostalCode:    r.PostalCode,
		Country:       r.Country,
		Latitude:      r.Latitude,
		Longitude:     r.Longitude,
		Timezone:      r.Timezone,
		DeliveryNotes: r.DeliveryNotes,
		IsDefault:     r.IsDefault,
	}
}

const selectCols = `
	id, label, line1, line2, unit, buzzer,
	city, province, postal_code, country,
	ST_Y(location::geometry) AS latitude,
	ST_X(location::geometry) AS longitude,
	timezone, delivery_notes, is_default`

func scanRow(row pgx.Row) (addressRow, error) {
	var a addressRow
	err := row.Scan(
		&a.ID, &a.Label, &a.Line1, &a.Line2, &a.Unit, &a.Buzzer,
		&a.City, &a.Province, &a.PostalCode, &a.Country,
		&a.Latitude, &a.Longitude,
		&a.Timezone, &a.DeliveryNotes, &a.IsDefault,
	)
	return a, err
}

// Sentinel errors.
var (
	ErrAddressNotFound  = errors.New("address not found")
	ErrAddressInUse     = errors.New("address is referenced by a live order")
	ErrTooManyAddresses = errors.New("maximum 20 addresses per customer")
)

// List returns all non-deleted addresses owned by accountID, ordered by
// created_at desc. Cursor-based pagination is not yet needed (spec allows a
// flat list for now); the meta fields are always returned for envelope shape.
func (r *Repo) List(ctx context.Context, accountID string) ([]addressRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+selectCols+`
		FROM address
		WHERE account_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`,
		accountID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []addressRow
	for rows.Next() {
		var a addressRow
		if err := rows.Scan(
			&a.ID, &a.Label, &a.Line1, &a.Line2, &a.Unit, &a.Buzzer,
			&a.City, &a.Province, &a.PostalCode, &a.Country,
			&a.Latitude, &a.Longitude,
			&a.Timezone, &a.DeliveryNotes, &a.IsDefault,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Get returns the address identified by id, scoped to accountID.
// Returns ErrAddressNotFound when the row does not exist or belongs to another account.
func (r *Repo) Get(ctx context.Context, accountID, id string) (addressRow, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+selectCols+`
		FROM address
		WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
		id, accountID,
	)
	a, err := scanRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return addressRow{}, ErrAddressNotFound
	}
	return a, err
}

// Create inserts a new address for the caller. The location geography point is
// built server-side from lat/lng; country is always 'CA'; timezone is provided
// by the caller (derived upstream from the point). Returns ErrTooManyAddresses
// when the account already has 20 non-deleted addresses.
func (r *Repo) Create(ctx context.Context, accountID string, in addressInputDTO, timezone string) (addressRow, error) {
	// Count check (≥ 20 → reject).
	var count int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM address WHERE account_id = $1 AND deleted_at IS NULL`,
		accountID,
	).Scan(&count); err != nil {
		return addressRow{}, err
	}
	if count >= 20 {
		return addressRow{}, ErrTooManyAddresses
	}

	isDefault := false
	if in.IsDefault != nil {
		isDefault = *in.IsDefault
	}

	row := r.pool.QueryRow(ctx, `
		INSERT INTO address
		  (account_id, label, line1, line2, unit, buzzer, city, province, postal_code,
		   location, timezone, delivery_notes, is_default)
		VALUES
		  ($1, $2, $3, $4, $5, $6, $7, $8, $9,
		   ST_SetSRID(ST_MakePoint($11, $10), 4326)::geography,
		   $12, $13, $14)
		RETURNING `+selectCols,
		accountID,
		in.Label,
		in.Line1,
		in.Line2,
		in.Unit,
		in.Buzzer,
		in.City,
		in.Province,
		in.PostalCode,
		in.Latitude,  // $10 = lat = ST_Y
		in.Longitude, // $11 = lon = ST_X
		timezone,
		in.DeliveryNotes,
		isDefault,
	)
	return scanRow(row)
}

// Update applies a partial update to an address owned by accountID.
// Returns ErrAddressNotFound when the address does not exist or belongs to another account.
//
// The whole update runs in a transaction because a PATCH that sets
// is_default:true must first clear the account's existing default — otherwise
// the partial unique index address_one_default (one is_default row per account)
// is violated and the raw UPDATE 23505s into a 500. Setting is_default:false, or
// leaving it unset, needs no pre-clear. This mirrors SetDefault's atomicity so
// the "exactly one default" invariant holds no matter which endpoint flips it.
func (r *Repo) Update(ctx context.Context, accountID, id string, in addressUpdateInputDTO) (addressRow, error) {
	// Build a dynamic update using COALESCE so unset fields are left unchanged.
	// We always do a full re-read after UPDATE to return the canonical shape.
	var lat, lon *float64
	if in.Latitude != nil {
		lat = in.Latitude
	}
	if in.Longitude != nil {
		lon = in.Longitude
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return addressRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// If this PATCH promotes the row to default, demote every other default for
	// the account first (excluding this row, so a self-promotion is idempotent).
	if in.IsDefault != nil && *in.IsDefault {
		if _, err := tx.Exec(ctx,
			`UPDATE address SET is_default = false, updated_at = now()
			 WHERE account_id = $1 AND id <> $2 AND is_default = true AND deleted_at IS NULL`,
			accountID, id,
		); err != nil {
			return addressRow{}, err
		}
	}

	// Use a CTE that handles optional lat/lon for location update.
	var row pgx.Row
	if lat != nil && lon != nil {
		row = tx.QueryRow(ctx, `
			UPDATE address SET
			  label          = COALESCE($3, label),
			  line1          = COALESCE($4, line1),
			  line2          = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE line2 END,
			  unit           = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE unit END,
			  buzzer         = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE buzzer END,
			  city           = COALESCE($8, city),
			  province       = COALESCE($9, province),
			  postal_code    = COALESCE($10, postal_code),
			  location       = ST_SetSRID(ST_MakePoint($12, $11), 4326)::geography,
			  delivery_notes = CASE WHEN $13::text IS NOT NULL THEN $13 ELSE delivery_notes END,
			  is_default     = COALESCE($14, is_default),
			  updated_at     = now()
			WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
			RETURNING `+selectCols,
			id, accountID,
			in.Label, in.Line1, in.Line2, in.Unit, in.Buzzer,
			in.City, in.Province, in.PostalCode,
			lat, lon,
			in.DeliveryNotes, in.IsDefault,
		)
	} else {
		row = tx.QueryRow(ctx, `
			UPDATE address SET
			  label          = COALESCE($3, label),
			  line1          = COALESCE($4, line1),
			  line2          = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE line2 END,
			  unit           = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE unit END,
			  buzzer         = CASE WHEN $7::text IS NOT NULL THEN $7 ELSE buzzer END,
			  city           = COALESCE($8, city),
			  province       = COALESCE($9, province),
			  postal_code    = COALESCE($10, postal_code),
			  delivery_notes = CASE WHEN $11::text IS NOT NULL THEN $11 ELSE delivery_notes END,
			  is_default     = COALESCE($12, is_default),
			  updated_at     = now()
			WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
			RETURNING `+selectCols,
			id, accountID,
			in.Label, in.Line1, in.Line2, in.Unit, in.Buzzer,
			in.City, in.Province, in.PostalCode,
			in.DeliveryNotes, in.IsDefault,
		)
	}

	a, err := scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return addressRow{}, ErrAddressNotFound
		}
		return addressRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return addressRow{}, err
	}
	return a, nil
}

// Delete soft-deletes the address identified by id for accountID.
// Returns ErrAddressNotFound, ErrAddressInUse when a live order references it.
func (r *Repo) Delete(ctx context.Context, accountID, id string) error {
	// Check existence + ownership.
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM address WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL)`,
		id, accountID,
	).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrAddressNotFound
	}

	// Check live order reference: non-terminal orders use delivery_address_id.
	// Terminal states (from migrations/00013_order.sql): COMPLETED, CANCELLED, REJECTED, FAILED, RESOLVED.
	var inUse bool
	if err := r.pool.QueryRow(ctx, `
		SELECT EXISTS(
		  SELECT 1 FROM "order"
		  WHERE delivery_address_id = $1
		  AND state NOT IN ('COMPLETED','CANCELLED','REJECTED','FAILED','RESOLVED')
		)`,
		id,
	).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return ErrAddressInUse
	}

	// Soft-delete.
	tag, err := r.pool.Exec(ctx,
		`UPDATE address SET deleted_at = now(), updated_at = now() WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL`,
		id, accountID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAddressNotFound
	}
	return nil
}

// SetDefault atomically flips is_default: unsets any current default for the
// account, then sets the target address as default. Uses a single UPDATE with
// a CASE expression so it is one round-trip and satisfies the partial unique
// index (address_one_default) by never leaving two rows true simultaneously.
func (r *Repo) SetDefault(ctx context.Context, accountID, id string) (addressRow, error) {
	// Verify ownership first.
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM address WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL)`,
		id, accountID,
	).Scan(&exists); err != nil {
		return addressRow{}, err
	}
	if !exists {
		return addressRow{}, ErrAddressNotFound
	}

	// Atomic flip: clear all defaults for the account, set only the target.
	// Two separate UPDATEs inside a transaction keep the partial unique index happy.
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return addressRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Clear existing defaults.
	if _, err := tx.Exec(ctx,
		`UPDATE address SET is_default = false, updated_at = now()
		 WHERE account_id = $1 AND is_default = true AND deleted_at IS NULL`,
		accountID,
	); err != nil {
		return addressRow{}, err
	}

	// Set the target.
	row := tx.QueryRow(ctx, `
		UPDATE address SET is_default = true, updated_at = now()
		WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL
		RETURNING `+selectCols,
		id, accountID,
	)
	a, err := scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return addressRow{}, ErrAddressNotFound
		}
		return addressRow{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return addressRow{}, err
	}
	return a, nil
}
