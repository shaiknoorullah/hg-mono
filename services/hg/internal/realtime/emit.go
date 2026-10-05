package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
)

// Emit writes one catalogue event to the transactional outbox inside the
// caller's transaction (contracts/websocket.md section 6.1): the event exists
// if and only if the state change in tx commits, and a rollback leaves no event
// behind. There is one function per channel family, and each accepts only the
// event types that travel on that channel, so an event cannot be put on the
// wrong channel: the compiler refuses it.
//
// Before writing, Emit refuses a payload whose enum field holds a value outside
// its closed set; the error rolls the caller's transaction back rather than
// sending a value no client can render.

// OrderEvent is an event on order:{order_id}.
type OrderEvent interface{ orderEvent() }

// RestaurantEvent is an event on restaurant:{restaurant_id}.
type RestaurantEvent interface{ restaurantEvent() }

// RiderEvent is an event on rider:{account_id}.
type RiderEvent interface{ riderEvent() }

// AccountEvent is an event on account:{account_id}.
type AccountEvent interface{ accountEvent() }

// AdminEvent is an event on admin:ops.
type AdminEvent interface{ adminEvent() }

func (OrderCreated) orderEvent()          {}
func (OrderStateChanged) orderEvent()     {}
func (OrderEtaUpdated) orderEvent()       {}
func (OrderItemsAdjusted) orderEvent()    {}
func (OrderCancelled) orderEvent()        {}
func (OrderCompleted) orderEvent()        {}
func (OrderNoteAdded) orderEvent()        {}
func (PaymentAuthorized) orderEvent()     {}
func (PaymentActionRequired) orderEvent() {}
func (PaymentCaptured) orderEvent()       {}
func (PaymentFailed) orderEvent()         {}
func (RefundCreated) orderEvent()         {}
func (RefundSettled) orderEvent()         {}
func (RefundFailed) orderEvent()          {}
func (DispatchAssigned) orderEvent()      {}
func (DispatchUnassigned) orderEvent()    {}
func (DispatchStateChanged) orderEvent()  {}

func (RestaurantOrderOffered) restaurantEvent()        {}
func (RestaurantOrderOfferExpired) restaurantEvent()   {}
func (RestaurantOrderOfferWithdrawn) restaurantEvent() {}
func (RestaurantOrderAccepted) restaurantEvent()       {}
func (RestaurantOrderRejected) restaurantEvent()       {}
func (RestaurantStatusChanged) restaurantEvent()       {}
func (RestaurantPayoutUpdated) restaurantEvent()       {}

func (DispatchOffer) riderEvent()            {}
func (DispatchOfferWithdrawn) riderEvent()   {}
func (RiderAvailabilityChanged) riderEvent() {}
func (RiderEarningsUpdated) riderEvent()     {}

func (AccountSecurityEvent) accountEvent()       {}
func (DocumentReviewStateChanged) accountEvent() {}
func (OnboardingStateChanged) accountEvent()     {}
func (ConnectRequirementsChanged) accountEvent() {}
func (NotificationCreated) accountEvent()        {}
func (NotificationRead) accountEvent()           {}

func (AdminAlert) adminEvent()                   {}
func (AdminDispatchFailure) adminEvent()         {}
func (AdminReconciliationException) adminEvent() {}
func (AdminQueueDepth) adminEvent()              {}

// EmitOrder writes an event on the order's channel.
func EmitOrder(ctx context.Context, tx pgx.Tx, orderID string, ev OrderEvent) error {
	oid := orderID
	return emit(ctx, tx, OrderChannel(orderID), ev, &oid, nil)
}

// riderLocationEvery is the contract's throttle: at most one rider.location per
// 5 seconds per order (contracts/websocket.md section 4.5).
const riderLocationEvery = 5 * time.Second

// EmitRiderLocation writes rider.location on the order's channel unless one was
// written for that order in the last 5 seconds; emitted reports which. It is the
// only way to emit rider.location (RiderLocation is not an OrderEvent), so the
// throttle cannot be skipped.
//
// The window is read from realtime_event in the caller's transaction. Position
// reports for one rider serialise on the rider's rider_position row before they
// get here, so two reports cannot both see an empty window.
func EmitRiderLocation(ctx context.Context, tx pgx.Tx, loc RiderLocation) (emitted bool, err error) {
	channel := OrderChannel(loc.OrderID)
	var recent bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM realtime_event
			 WHERE channel = $1 AND type = 'rider.location'
			   AND created_at > now() - make_interval(secs => $2))`,
		channel, riderLocationEvery.Seconds()).Scan(&recent); err != nil {
		return false, fmt.Errorf("realtime: rider.location throttle: %w", err)
	}
	if recent {
		return false, nil
	}
	oid := loc.OrderID
	if err := emit(ctx, tx, channel, loc, &oid, nil); err != nil {
		return false, err
	}
	return true, nil
}

// EmitRestaurant writes an event on the restaurant's channel. orderID, when the
// event is about an order, indexes the stored row for support; it is not sent.
func EmitRestaurant(ctx context.Context, tx pgx.Tx, restaurantID string, orderID *string, ev RestaurantEvent) error {
	return emit(ctx, tx, RestaurantChannel(restaurantID), ev, orderID, nil)
}

// EmitRider writes an event on the rider's own channel.
func EmitRider(ctx context.Context, tx pgx.Tx, riderAccountID string, ev RiderEvent) error {
	aid := riderAccountID
	return emit(ctx, tx, RiderChannel(riderAccountID), ev, nil, &aid)
}

// EmitAccount writes an event on the account's own channel.
func EmitAccount(ctx context.Context, tx pgx.Tx, accountID string, ev AccountEvent) error {
	aid := accountID
	return emit(ctx, tx, AccountChannel(accountID), ev, nil, &aid)
}

// EmitAdmin writes an event on admin:ops.
func EmitAdmin(ctx context.Context, tx pgx.Tx, orderID *string, ev AdminEvent) error {
	return emit(ctx, tx, AdminOpsChannel, ev, orderID, nil)
}

func emit(ctx context.Context, tx pgx.Tx, channel string, ev any, orderID, accountID *string) error {
	s, ok := bySource[reflect.TypeOf(ev)]
	if !ok {
		return fmt.Errorf("realtime: %T is not a catalogue event", ev)
	}
	if err := checkEnums(reflect.ValueOf(ev), s.typ); err != nil {
		return err
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("realtime: marshal %s: %w", s.typ, err)
	}
	if _, _, err := EmitInTx(ctx, tx, channel, s.typ, 1, nil, payload, orderID, accountID); err != nil {
		return fmt.Errorf("realtime: emit %s: %w", s.typ, err)
	}
	return nil
}

// validator is implemented by every closed string set: the generated
// openapi.yaml enums and the inline sets in events.go.
type validator interface{ Valid() bool }

var validatorType = reflect.TypeFor[validator]()

// checkEnums walks a payload and refuses any enum field outside its set.
func checkEnums(v reflect.Value, path string) error {
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return nil
		}
		return checkEnums(v.Elem(), path)
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			if err := checkEnums(v.Index(i), fmt.Sprintf("%s[%d]", path, i)); err != nil {
				return err
			}
		}
		return nil
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			f := v.Type().Field(i)
			if !f.IsExported() {
				continue
			}
			name, _ := jsonName(f)
			if err := checkEnums(v.Field(i), path+"."+name); err != nil {
				return err
			}
		}
		return nil
	}
	if v.Type().Implements(validatorType) && !v.Interface().(validator).Valid() {
		return fmt.Errorf("realtime: %s = %q is not a member of %s", path, v.String(), v.Type().Name())
	}
	return nil
}
