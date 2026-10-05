package restaurant

// The menu lock (https://github.com/shaiknoorullah/hg-mono/issues/256). While a
// restaurant is SUSPENDED or BANNED nobody changes its menu: not its own staff, and
// not an admin acting on its behalf. A version already waiting in menu review stays as
// it is. A DELISTED restaurant (taken out of customer listings without a penalty, for
// example when its certificate expires) is not locked, so it can get its menu ready to
// be listed again. Reading the menu is never locked. The owner's decision is the row
// "A suspended or banned restaurant's menu" in docs/decisions/README.md (round 2).
//
// The rule lives here and nowhere else. Every menu write, in this package and in
// internal/admin, calls LockMenuForWrite (or LockMenuForWriteExclusive) as the first
// statement of the transaction that makes the write, and answers a refusal with
// RespondMenuLocked. The route tests in both packages list every menu write route and
// fail when one has no suspended-restaurant case, so a write path added later cannot
// skip the check without a test going red.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// CodeMenuLocked is the code every menu write answers while the menu is locked. It is
// not ACCOUNT_SUSPENDED: that one means the caller's own account is suspended, and
// clients answer it with the suspension screen. Here the caller stays signed in and
// only the menu is locked. Taken from the generated contract types, so it cannot drift
// from the contract's ErrorCode enum.
const CodeMenuLocked = httpx.ErrorCode(contract.ErrorCodeMENULOCKED)

// ErrMenuLocked is the menu lock's refusal. errors.Is matches it on every error
// LockMenuForWrite returns for a locked menu; errors.As with *MenuLockedError gives the
// account state that locked it.
var ErrMenuLocked = errors.New("menu locked: the restaurant is suspended or banned")

// MenuLockedError is the refusal with the restaurant's account state.
type MenuLockedError struct {
	AccountState string // SUSPENDED or BANNED
}

// Error names the refusal and the account state.
func (e *MenuLockedError) Error() string {
	return fmt.Sprintf("%v (account_state %s)", ErrMenuLocked, e.AccountState)
}

// Is makes errors.Is(err, ErrMenuLocked) true.
func (e *MenuLockedError) Is(target error) bool { return target == ErrMenuLocked }

// menuLockedStates are the account states that lock the menu. DELISTED is
// deliberately absent: delisting is not a penalty, and a delisted restaurant keeps
// editing its menu.
var menuLockedStates = map[string]bool{
	"SUSPENDED": true,
	"BANNED":    true,
}

// LockMenuForWrite is the menu lock's check. Call it as the first statement of the
// transaction that writes the menu. It takes a FOR SHARE lock on the restaurant row
// and reads the account state under that lock, then:
//
//   - returns *MenuLockedError (errors.Is ErrMenuLocked) when the restaurant is
//     SUSPENDED or BANNED: write nothing and roll back;
//   - returns ErrNotFound when the restaurant does not exist;
//   - returns nil otherwise, and the lock holds until the transaction ends.
//
// The lock is what makes a write and a suspension race safely. Suspending a restaurant
// updates its row, and an update waits for every FOR SHARE lock on the row, so a write
// holding the lock commits before the suspension does. A write that asks for the lock
// while a suspension is in progress waits for the suspension to commit, then reads the
// new state and is refused. A write is never committed after the suspension that should
// have refused it. FOR SHARE, not FOR KEY SHARE: KEY SHARE does not conflict with an
// update that leaves the key alone, so it would not hold the suspension back. Menu
// writes take compatible locks, so they still run side by side.
//
// The transaction type is the point: outside a transaction the lock would end with the
// statement, and the check would mean nothing.
func LockMenuForWrite(ctx context.Context, tx pgx.Tx, restaurantID string) error {
	return lockMenu(ctx, tx, restaurantID, "FOR SHARE")
}

// LockMenuForWriteExclusive is LockMenuForWrite with a FOR UPDATE lock, for a menu write
// that goes on to update the restaurant row itself in the same transaction (approving a
// menu version can complete onboarding, which updates the row). Two such writes that
// each held a FOR SHARE lock would each wait for the other to release it before
// updating: a deadlock. Taking the stronger lock first makes the second one wait at
// the start instead.
func LockMenuForWriteExclusive(ctx context.Context, tx pgx.Tx, restaurantID string) error {
	return lockMenu(ctx, tx, restaurantID, "FOR UPDATE")
}

func lockMenu(ctx context.Context, tx pgx.Tx, restaurantID, lockClause string) error {
	var state string
	err := tx.QueryRow(ctx,
		`SELECT account_state::text FROM restaurant WHERE id = $1 `+lockClause,
		restaurantID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock restaurant for a menu write: %w", err)
	}
	if menuLockedStates[state] {
		return &MenuLockedError{AccountState: state}
	}
	return nil
}

// RespondMenuLocked writes the menu lock's refusal when err is one, and reports whether
// it did: 403 MENU_LOCKED, with the account state in details. The restaurant's and the
// admin's handlers both use it, so the refusal reads the same to everyone.
func RespondMenuLocked(w http.ResponseWriter, r *http.Request, err error) bool {
	var locked *MenuLockedError
	if !errors.As(err, &locked) {
		return false
	}
	httpx.Fail(w, r, http.StatusForbidden, CodeMenuLocked,
		"This restaurant's menu is locked while the restaurant is "+
			strings.ToLower(locked.AccountState)+".",
		map[string]any{"account_state": locked.AccountState})
	return true
}
