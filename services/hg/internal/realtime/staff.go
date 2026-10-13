package realtime

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// StaffName is how the restaurant's other tablets name the staff member who
// answered an order or changed the restaurant's status
// (restaurant.order_accepted's accepted_by, restaurant.order_rejected's
// rejected_by, restaurant.status_changed's changed_by): first name and last
// initial, "Hamza K.", from the staff profile, read in the caller's
// transaction. Never an account id or a full name.
func StaffName(ctx context.Context, tx pgx.Tx, accountID string) (string, error) {
	const fallback = "Restaurant staff"
	if accountID == "" {
		return fallback, nil
	}
	var full string
	err := tx.QueryRow(ctx, `SELECT full_name FROM restaurant_staff_profile WHERE account_id = $1`, accountID).Scan(&full)
	if errors.Is(err, pgx.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return "", fmt.Errorf("realtime: staff name: %w", err)
	}
	return shortName(full, fallback), nil
}

// shortName renders "Hamza Khan" as "Hamza K.".
func shortName(full, fallback string) string {
	parts := strings.Fields(full)
	switch len(parts) {
	case 0:
		return fallback
	case 1:
		return parts[0]
	}
	last := []rune(parts[len(parts)-1])
	return parts[0] + " " + strings.ToUpper(string(last[0])) + "."
}
