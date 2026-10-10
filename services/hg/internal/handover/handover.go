// Package handover keeps the two 4-digit handover codes that prove the rider
// was where the food changed hands:
//
//   - the pickup code, which the kitchen reads to the rider at the counter;
//   - the delivery code, which the customer reads to the rider at a met
//     handover (delivery instruction MEET_AT_DOOR or MEET_IN_LOBBY).
//
// The rider is never sent either code; each one is heard from the person who
// holds it and typed in. The contract leaves the rider no way past either one
// (contracts/README.md, "Neither code can be bypassed", from the security
// review on https://github.com/shaiknoorullah/hg-mono/issues/183, contract
// https://github.com/shaiknoorullah/hg-mono/pull/290). This package is the one
// place the backend mints, stores, reveals and compares them
// (https://github.com/shaiknoorullah/hg-mono/issues/310,
// https://github.com/shaiknoorullah/hg-mono/issues/259):
//
//   - Mint: a code is drawn from crypto/rand, uniformly over 0000–9999, when
//     the order reaches the step that needs it (the pickup code at the
//     restaurant's acceptance, the delivery code at pickup).
//   - Store: sealed with AES-256-GCM under APP_DATA_KEY, like the staff TOTP
//     secret, and not hashed, because the server shows each code again
//     (https://github.com/shaiknoorullah/hg-mono/issues/289). The GCM
//     associated data names the order and the code, so a ciphertext moved to
//     another order or column does not open.
//   - Compare: in constant time.
//   - Count: five wrong codes per code per order, counted on the order row
//     under its row lock with one conditional increment, and committed even
//     though the step itself is refused, so a Redis flush or a retry cannot
//     reset the count.
//   - Reveal: only the views the contract names call Reveal — the pickup code
//     on the restaurant staff's order view, the delivery code on the customer's
//     own order and tracking views. No rider-visible response, realtime event,
//     push or error body carries a code.
//
// Callers own the transaction. Lock order is the assignment row first, then
// the order row, everywhere a code is checked, so a rider's attempt and a
// support override can never deadlock each other.
package handover

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync/atomic"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Kind says which handover code. The values are the contract's
// HandoverCodeKind and the Postgres handover_code_kind enum.
type Kind string

const (
	// Pickup is the code the kitchen reads to the rider at the counter.
	Pickup Kind = "PICKUP"
	// Delivery is the code the customer reads to the rider at a met handover.
	Delivery Kind = "DELIVERY"
)

// Valid reports whether k is one of the two codes.
func (k Kind) Valid() bool { return k == Pickup || k == Delivery }

// MaxAttempts is the number of wrong codes per code per order. The fifth wrong
// code locks the code, and the order goes to support.
const MaxAttempts = 5

// encColumn and attemptsColumn name the order columns for a code. They are
// fixed strings chosen by Kind, never caller input, so building SQL with them
// is safe.
func (k Kind) encColumn() string {
	if k == Delivery {
		return "delivery_code_enc"
	}
	return "pickup_code_enc"
}

func (k Kind) attemptsColumn() string {
	if k == Delivery {
		return "delivery_code_attempts"
	}
	return "pickup_code_attempts"
}

// ---------------------------------------------------------------------------
// The key.
// ---------------------------------------------------------------------------

var dataKey atomic.Pointer[[32]byte]

// UseKey sets the APP_DATA_KEY the codes are sealed under. cmd/hg calls it once
// at boot with the same key auth seals TOTP secrets under (HG_APP_DATA_KEY).
//
// The key is process-wide on purpose: every module that seals or opens a code
// (orders, restaurant, dispatch, admin) must use the same key, and one setting
// makes "two modules disagree on the key" impossible. Until UseKey is called
// the key is 32 zero bytes, which is HG_APP_DATA_KEY's documented local default
// (internal/auth/config.go), so tests and local runs seal and open consistently.
func UseKey(k [32]byte) { dataKey.Store(&k) }

func key() [32]byte {
	if p := dataKey.Load(); p != nil {
		return *p
	}
	return [32]byte{}
}

// ---------------------------------------------------------------------------
// Minting, sealing and comparing.
// ---------------------------------------------------------------------------

// WellFormed reports whether s has the shape of a code: exactly four ASCII
// digits. Handlers reject anything else as VALIDATION_FAILED, naming the field
// and never echoing the value.
func WellFormed(s string) bool {
	if len(s) != 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// newCode draws a code uniformly from 0000–9999 with crypto/rand.
func newCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", fmt.Errorf("handover: draw code: %w", err)
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

// associatedData binds a ciphertext to its order and to which code it is.
func associatedData(orderID string, k Kind) []byte {
	return []byte("hg/handover-code/v1|" + string(k) + "|" + strings.ToLower(orderID))
}

func aead() (cipher.AEAD, error) {
	k := key()
	block, err := aes.NewCipher(k[:])
	if err != nil {
		return nil, fmt.Errorf("handover: new cipher: %w", err)
	}
	return cipher.NewGCM(block)
}

// seal encrypts a code: nonce || ciphertext || tag, the layout auth uses for
// totp_secret_enc.
func seal(orderID string, k Kind, code string) ([]byte, error) {
	g, err := aead()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("handover: nonce: %w", err)
	}
	return g.Seal(nonce, nonce, []byte(code), associatedData(orderID, k)), nil
}

// open decrypts a sealed code. ok is false when there is no code or it does
// not open (wrong key, wrong order or column, or tampered).
func open(orderID string, k Kind, sealed []byte) (string, bool) {
	if len(sealed) == 0 {
		return "", false
	}
	g, err := aead()
	if err != nil {
		return "", false
	}
	ns := g.NonceSize()
	if len(sealed) < ns {
		return "", false
	}
	plain, err := g.Open(nil, sealed[:ns], sealed[ns:], associatedData(orderID, k))
	if err != nil || !WellFormed(string(plain)) {
		return "", false
	}
	return string(plain), true
}

// matches compares a typed code with the sealed one in constant time. When
// there is no code to compare against, nothing matches, and the comparison
// still runs against a placeholder so the timing does not say which case it
// was.
func matches(orderID string, k Kind, sealed []byte, typed string) bool {
	want, ok := open(orderID, k, sealed)
	if !ok {
		want = "\x00\x00\x00\x00"
	}
	same := subtle.ConstantTimeCompare([]byte(want), []byte(typed)) == 1
	return ok && WellFormed(typed) && same
}

// Reveal opens a sealed code for one of the views the contract lets show it
// (see PickupCodeVisible and DeliveryCodeVisible). It returns nil when there is
// no code or it does not open, so a view shows null rather than failing.
func Reveal(orderID string, k Kind, sealed []byte) *string {
	code, ok := open(orderID, k, sealed)
	if !ok {
		return nil
	}
	return &code
}

// ---------------------------------------------------------------------------
// Who may see a code, and when (contracts/openapi.yaml,
// OrderRestaurantView.pickup_code and OrderCustomerView.delivery_code).
// ---------------------------------------------------------------------------

// MetHandover reports whether the order's delivery instructions ask the rider
// to meet the customer, which makes the delivery code the proof of delivery.
func MetHandover(instructions []string) bool {
	for _, in := range instructions {
		if in == "MEET_AT_DOOR" || in == "MEET_IN_LOBBY" {
			return true
		}
	}
	return false
}

// PickupCodeVisible reports whether the restaurant's order view carries the
// pickup code: from acceptance until pickup (PREPARING, READY_FOR_PICKUP), for
// an order a rider collects, and not once five wrong codes have locked it.
func PickupCodeVisible(state, fulfilment string, attempts int) bool {
	return (state == "PREPARING" || state == "READY_FOR_PICKUP") &&
		fulfilment == "DELIVERY" && attempts < MaxAttempts
}

// DeliveryCodeVisible reports whether the customer's own order and tracking
// views carry the delivery code: while the order is out for delivery
// (PICKED_UP, ARRIVED) at a met handover, and not once five wrong codes have
// locked it.
func DeliveryCodeVisible(state string, instructions []string, attempts int) bool {
	return (state == "PICKED_UP" || state == "ARRIVED") &&
		MetHandover(instructions) && attempts < MaxAttempts
}

// ---------------------------------------------------------------------------
// Database steps. Each runs inside the caller's transaction.
// ---------------------------------------------------------------------------

// Querier is the part of pgx.Tx (and *pgxpool.Pool) these steps use.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// MintTx draws a fresh code and stores it sealed on the order. An order that
// already has this code keeps it: the kitchen or the customer may already have
// seen it, so it is never silently replaced.
func MintTx(ctx context.Context, q Querier, orderID string, k Kind) error {
	code, err := newCode()
	if err != nil {
		return err
	}
	return storeTx(ctx, q, orderID, k, code, false)
}

// SetCodeTx stores a known code on the order, replacing any code it had. It is
// for seeds and tests that need to type a code; production paths call MintTx.
func SetCodeTx(ctx context.Context, q Querier, orderID string, k Kind, code string) error {
	if !WellFormed(code) {
		return errors.New("handover: a code is four digits")
	}
	return storeTx(ctx, q, orderID, k, code, true)
}

func storeTx(ctx context.Context, q Querier, orderID string, k Kind, code string, replace bool) error {
	sealed, err := seal(orderID, k, code)
	if err != nil {
		return err
	}
	set := "COALESCE(" + k.encColumn() + ", $2)"
	if replace {
		set = "$2"
	}
	tag, err := q.Exec(ctx, `UPDATE "order" SET `+k.encColumn()+` = `+set+` WHERE id = $1`, orderID, sealed)
	if err != nil {
		return fmt.Errorf("handover: store %s code: %w", strings.ToLower(string(k)), err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("handover: store %s code: no order %s", strings.ToLower(string(k)), orderID)
	}
	return nil
}

// RetireTx deletes the stored codes, so no later attempt can use them. The
// orders module calls it as each handover happens; nothing is kept that is no
// longer needed.
func RetireTx(ctx context.Context, q Querier, orderID string, kinds ...Kind) error {
	for _, k := range kinds {
		if _, err := q.Exec(ctx, `UPDATE "order" SET `+k.encColumn()+` = NULL WHERE id = $1`, orderID); err != nil {
			return fmt.Errorf("handover: retire %s code: %w", strings.ToLower(string(k)), err)
		}
	}
	return nil
}

// Outcome is what checking a typed code decided.
type Outcome int

const (
	// Matched: the code is right. The caller goes on with the handover.
	Matched Outcome = iota
	// Missing: no code was sent, and the code is not locked. Nothing counted.
	Missing
	// Incorrect: the code is wrong. The attempt is counted;
	// Result.AttemptsRemaining is at least one.
	Incorrect
	// LockedNow: this wrong code was the fifth. The code locked in this
	// transaction, and the caller must raise the alert that hands the order to
	// support before committing.
	LockedNow
	// Locked: the code had already locked. Nothing was compared or counted.
	Locked
)

// Result is the outcome of CheckTx.
type Result struct {
	Outcome Outcome
	// AttemptsRemaining is how many wrong codes are left before the lock.
	AttemptsRemaining int
}

// CheckTx compares a typed code with the order's code inside tx.
//
// It locks the order row (the caller locks the assignment first), refuses
// straight away when the code has locked, and otherwise compares in constant
// time. A wrong code is counted with one conditional increment
// (`... SET n = n + 1 WHERE n < 5 RETURNING n`, the rule in #289), so even
// concurrent attempts cannot count past five. The caller commits tx for every
// outcome but Missing, including the refusals: the count must survive the
// refused step.
func CheckTx(ctx context.Context, tx pgx.Tx, orderID string, k Kind, typed *string) (Result, error) {
	var sealed []byte
	var attempts int
	err := tx.QueryRow(ctx,
		`SELECT `+k.encColumn()+`, `+k.attemptsColumn()+` FROM "order" WHERE id = $1 FOR UPDATE`,
		orderID).Scan(&sealed, &attempts)
	if err != nil {
		return Result{}, fmt.Errorf("handover: lock order for %s code: %w", strings.ToLower(string(k)), err)
	}
	if attempts >= MaxAttempts {
		return Result{Outcome: Locked}, nil
	}
	if typed == nil {
		return Result{Outcome: Missing, AttemptsRemaining: MaxAttempts - attempts}, nil
	}
	if matches(orderID, k, sealed, *typed) {
		return Result{Outcome: Matched, AttemptsRemaining: MaxAttempts - attempts}, nil
	}

	var counted int
	err = tx.QueryRow(ctx,
		`UPDATE "order" SET `+k.attemptsColumn()+` = `+k.attemptsColumn()+` + 1
		  WHERE id = $1 AND `+k.attemptsColumn()+` < $2
		 RETURNING `+k.attemptsColumn(),
		orderID, MaxAttempts).Scan(&counted)
	if errors.Is(err, pgx.ErrNoRows) {
		// The conditional write is the authority: the count had reached five.
		return Result{Outcome: Locked}, nil
	}
	if err != nil {
		return Result{}, fmt.Errorf("handover: count wrong %s code: %w", strings.ToLower(string(k)), err)
	}
	if counted >= MaxAttempts {
		return Result{Outcome: LockedNow}, nil
	}
	return Result{Outcome: Incorrect, AttemptsRemaining: MaxAttempts - counted}, nil
}

// WrongAttemptsTx reads how many wrong codes have been tried for a code, for
// the support override's audit record. The caller holds the order's row lock.
func WrongAttemptsTx(ctx context.Context, q Querier, orderID string, k Kind) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT `+k.attemptsColumn()+` FROM "order" WHERE id = $1`, orderID).Scan(&n)
	return n, err
}
