// Package orders — order ratings (C-38, scoped to the food + rider targets).
// Durable Postgres storage (order_food_rating / order_rider_rating, migration
// 00025): a rating survives a restart and feeds the restaurant's/rider's
// rating_avg + rating_count aggregates in the same transaction as the write —
// there is no in-memory rating store anywhere in this path.
package orders

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Rating errors mapped to contract error codes by Handler.fail.
var (
	ErrReviewWindowClosed     = errors.New("orders: review window closed")
	ErrReviewEditWindowClosed = errors.New("orders: review edit window closed")
)

const (
	codeReviewWindowClosed     httpx.ErrorCode = "REVIEW_WINDOW_CLOSED"
	codeReviewEditWindowClosed httpx.ErrorCode = "REVIEW_EDIT_WINDOW_CLOSED"
)

// reviewWindow is the 14-day submission window from delivered_at (C-38 rule 4).
const reviewWindow = 14 * 24 * time.Hour

// editWindow is the 24 h edit window from a rating's own created_at (C-38 rule 2).
const editWindow = 24 * time.Hour

// ---- store rows ----

type foodRatingRow struct {
	OrderID      string
	RestaurantID string
	Score        int
	Review       *string
	Tags         []string
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type riderRatingRow struct {
	OrderID   string
	Score     int
	Comment   *string
	Tags      []string
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ratingInput is the caller-provided half of one target (food or rider).
type ratingInput struct {
	Score int
	Text  *string // review (food) or comment (rider)
	Tags  []string
}

// GetOrderRating returns the customer's rating state for orderID (owned by
// accountID via order_visibility, P-07). Either half is nil when not yet rated.
func (s *Store) GetOrderRating(ctx context.Context, accountID, orderID string) (*foodRatingRow, *riderRatingRow, error) {
	if !isCanonicalUUID(orderID) {
		return nil, nil, ErrOrderNotFound
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT true FROM "order" o
		  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
		 WHERE o.id = $2`, accountID, orderID).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrOrderNotFound
		}
		return nil, nil, err
	}

	food, err := s.loadFoodRating(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	rider, err := s.loadRiderRating(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	return food, rider, nil
}

func (s *Store) loadFoodRating(ctx context.Context, orderID string) (*foodRatingRow, error) {
	var f foodRatingRow
	err := s.pool.QueryRow(ctx, `
		SELECT order_id, restaurant_id, score, review, tags, status::text, created_at, updated_at
		  FROM order_food_rating WHERE order_id = $1`, orderID).Scan(
		&f.OrderID, &f.RestaurantID, &f.Score, &f.Review, &f.Tags, &f.Status, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func (s *Store) loadRiderRating(ctx context.Context, orderID string) (*riderRatingRow, error) {
	var rr riderRatingRow
	err := s.pool.QueryRow(ctx, `
		SELECT order_id, score, comment, tags, status::text, created_at, updated_at
		  FROM order_rider_rating WHERE order_id = $1`, orderID).Scan(
		&rr.OrderID, &rr.Score, &rr.Comment, &rr.Tags, &rr.Status, &rr.CreatedAt, &rr.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rr, nil
}

// SubmitOrderRating upserts the food and/or rider rating for orderID (owned by
// accountID). At least one of food/rider must be non-nil (the handler enforces
// this before calling in). Each provided target's aggregate is recomputed in
// the same transaction, from PUBLISHED rows only (C-38 rule 5).
func (s *Store) SubmitOrderRating(ctx context.Context, accountID, orderID string, food, rider *ratingInput) (*foodRatingRow, *riderRatingRow, error) {
	if !isCanonicalUUID(orderID) {
		return nil, nil, ErrOrderNotFound
	}

	var restaurantID string
	var riderAccountID *string
	var state string
	var deliveredAt *time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT o.restaurant_id, o.state::text, o.delivered_at,
		       (SELECT d.rider_account_id FROM dispatch d WHERE d.order_id = o.id)
		  FROM "order" o
		  JOIN order_visibility ov ON ov.order_id = o.id AND ov.account_id = $1 AND ov.via = 'CUSTOMER'
		 WHERE o.id = $2`, accountID, orderID).Scan(&restaurantID, &state, &deliveredAt, &riderAccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if state != "DELIVERED" && state != "COMPLETED" {
		return nil, nil, ErrReviewWindowClosed
	}
	if deliveredAt == nil || time.Since(*deliveredAt) > reviewWindow {
		return nil, nil, ErrReviewWindowClosed
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	if food != nil {
		if err := upsertFoodRating(ctx, tx, accountID, orderID, restaurantID, *food); err != nil {
			return nil, nil, err
		}
	}
	if rider != nil {
		if riderAccountID == nil {
			return nil, nil, ErrReviewWindowClosed
		}
		if err := upsertRiderRating(ctx, tx, accountID, orderID, *riderAccountID, *rider); err != nil {
			return nil, nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}

	f, err := s.loadFoodRating(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	rr, err := s.loadRiderRating(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	return f, rr, nil
}

func upsertFoodRating(ctx context.Context, tx pgx.Tx, accountID, orderID, restaurantID string, in ratingInput) error {
	var existingCreatedAt *time.Time
	if err := tx.QueryRow(ctx, `SELECT created_at FROM order_food_rating WHERE order_id = $1`, orderID).Scan(&existingCreatedAt); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if existingCreatedAt != nil && time.Since(*existingCreatedAt) > editWindow {
		return ErrReviewEditWindowClosed
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO order_food_rating (order_id, customer_id, restaurant_id, score, review, tags)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (order_id) DO UPDATE SET score = $4, review = $5, tags = $6, updated_at = now()`,
		orderID, accountID, restaurantID, in.Score, in.Text, in.Tags); err != nil {
		return err
	}

	_, err := tx.Exec(ctx, `
		UPDATE restaurant SET rating_count = agg.n, rating_avg = agg.avg
		  FROM (SELECT count(*) AS n, avg(score)::numeric(3,2) AS avg
		          FROM order_food_rating WHERE restaurant_id = $1 AND status = 'PUBLISHED') agg
		 WHERE restaurant.id = $1`, restaurantID)
	return err
}

func upsertRiderRating(ctx context.Context, tx pgx.Tx, accountID, orderID, riderAccountID string, in ratingInput) error {
	var existingCreatedAt *time.Time
	if err := tx.QueryRow(ctx, `SELECT created_at FROM order_rider_rating WHERE order_id = $1`, orderID).Scan(&existingCreatedAt); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if existingCreatedAt != nil && time.Since(*existingCreatedAt) > editWindow {
		return ErrReviewEditWindowClosed
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO order_rider_rating (order_id, customer_id, rider_account_id, score, comment, tags)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (order_id) DO UPDATE SET score = $4, comment = $5, tags = $6, updated_at = now()`,
		orderID, accountID, riderAccountID, in.Score, in.Text, in.Tags); err != nil {
		return err
	}

	_, err := tx.Exec(ctx, `
		UPDATE rider_profile SET rating_count = agg.n, rating_avg = agg.avg
		  FROM (SELECT count(*) AS n, avg(score)::numeric(3,2) AS avg
		          FROM order_rider_rating WHERE rider_account_id = $1 AND status = 'PUBLISHED') agg
		 WHERE rider_profile.account_id = $1`, riderAccountID)
	return err
}
