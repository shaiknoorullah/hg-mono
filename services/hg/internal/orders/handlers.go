// Package orders' HTTP handlers. Each maps one contract operation to the store,
// decodes the body with an unknown-field-rejecting decoder (so any price-shaped
// field is 422 UNKNOWN_FIELD, G-3), and renders the contract DTO. Errors are
// mapped to the exact contract ErrorCode.
package orders

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders/pricing"
)

// Contract ErrorCode members this module emits. Each exists in the contract's
// ErrorCode enum (verified against contracts/openapi.yaml).
const (
	codeUnknownField        httpx.ErrorCode = "UNKNOWN_FIELD"
	codeValidationFailed    httpx.ErrorCode = "VALIDATION_FAILED"
	codeDifferentRestaurant httpx.ErrorCode = "DIFFERENT_RESTAURANT"
	codeItemUnavailable     httpx.ErrorCode = "ITEM_UNAVAILABLE"
	codeRestaurantClosed    httpx.ErrorCode = "RESTAURANT_CLOSED"
	codeCartHasUnavailable  httpx.ErrorCode = "CART_HAS_UNAVAILABLE_ITEMS"
	codeBelowMinimum        httpx.ErrorCode = "BELOW_MINIMUM_ORDER"
	codeProvinceNotServed   httpx.ErrorCode = "PROVINCE_NOT_SERVED"
	codeTaxProfileMissing   httpx.ErrorCode = "TAX_PROFILE_MISSING"
	codeQuoteStale          httpx.ErrorCode = "QUOTE_STALE"
	codeQuoteExpired        httpx.ErrorCode = "QUOTE_EXPIRED"
	codeActiveOrderExists   httpx.ErrorCode = "ACTIVE_ORDER_EXISTS"
	codeCancellationClosed  httpx.ErrorCode = "CANCELLATION_WINDOW_CLOSED"
	codeIllegalTransition   httpx.ErrorCode = "ILLEGAL_TRANSITION"
	codeNotFound            httpx.ErrorCode = "NOT_FOUND"
	codeReceiptNotReady     httpx.ErrorCode = "RECEIPT_NOT_READY"
	// codeOrderingPaused: staff paused new orders platform-wide
	// (https://github.com/shaiknoorullah/hg-mono/issues/244). Always 409, the
	// same as RESTAURANT_CLOSED; the contract's createOrder says why not 503.
	codeOrderingPaused httpx.ErrorCode = "ORDERING_PAUSED"
)

// P-05 actions this module guards its routes with. The auth sibling's matrix
// maps roles to these; the machine package owns the transition actions.
const (
	ActionCartRead              httpx.Action = "cart.read"
	ActionCartWrite             httpx.Action = "cart.write"
	ActionQuoteCreate           httpx.Action = "quote.create"
	ActionQuoteRead             httpx.Action = "quote.read"
	ActionOrderCreate           httpx.Action = "order.create"
	ActionOrderRead             httpx.Action = "order.read"
	ActionOrderCancel           httpx.Action = "order.cancel"
	ActionOrderTrackingRead     httpx.Action = "order.tracking.read"
	ActionOrderReceiptRead      httpx.Action = "order.receipt.read"
	ActionOrderRiderProfileRead httpx.Action = "order.rider_profile.read"
	ActionOrderRatingRead       httpx.Action = "order.rating.read"
	ActionOrderRatingWrite      httpx.Action = "order.rating.write"
)

// Handler serves the cart, quote and order operations.
type Handler struct {
	store   *Store
	gateway PaymentGateway
	log     *slog.Logger
}

// NewHandler builds the orders handler. gw is the payments boundary; pass a real
// gateway from the payments module or the unwired default (which 503s honestly).
func NewHandler(store *Store, gw PaymentGateway, log *slog.Logger) *Handler {
	if gw == nil {
		gw = unwiredGateway{}
	}
	if log == nil {
		log = slog.Default()
	}
	return &Handler{store: store, gateway: gw, log: log}
}

// decodeStrict decodes a JSON body rejecting unknown fields. An unknown field
// (any price-shaped field on an input DTO) becomes 422 UNKNOWN_FIELD (G-3).
func decodeStrict(w http.ResponseWriter, r *http.Request, dst any) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Fail(w, r, http.StatusBadRequest, codeValidationFailed, "Could not read request body.", nil)
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if f, ok := unknownFieldName(err); ok {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeUnknownField,
				"The request contains a field that is not accepted on this operation.",
				[]httpx.FieldError{{Field: f, Code: "unknown", Message: "field not accepted"}})
			return false
		}
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"The request body is not valid.", nil)
		return false
	}
	return true
}

func unknownFieldName(err error) (string, bool) {
	const prefix = "json: unknown field "
	msg := err.Error()
	if strings.HasPrefix(msg, prefix) {
		return strings.Trim(strings.TrimPrefix(msg, prefix), `"`), true
	}
	return "", false
}

func (h *Handler) accountID(r *http.Request) string {
	return httpx.PrincipalFrom(r.Context()).AccountID
}

// ---- Cart ----

func (h *Handler) GetCart(w http.ResponseWriter, r *http.Request) {
	c, err := h.store.GetCart(r.Context(), h.accountID(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, cartToDTO(c))
}

func (h *Handler) AddCartLine(w http.ResponseWriter, r *http.Request) {
	var in cartLineInputDTO
	if !decodeStrict(w, r, &in) {
		return
	}
	if in.MenuItemID == "" || in.Quantity < 1 || in.Quantity > 20 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"menu_item_id is required and quantity must be 1..20.", nil)
		return
	}
	replace := r.URL.Query().Get("replace") == "true"
	li := CartLineInput{
		MenuItemID: in.MenuItemID, VariantID: in.VariantID, Quantity: in.Quantity, SpecialRequest: in.SpecialRequest,
	}
	for _, a := range in.Addons {
		qty := 1
		if a.Quantity != nil {
			qty = *a.Quantity
		}
		li.Addons = append(li.Addons, CartAddonInput{AddonID: a.AddonID, Quantity: qty})
	}
	c, err := h.store.AddCartLine(r.Context(), h.accountID(r), "", li, replace)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, cartToDTO(c))
}

func (h *Handler) UpdateCartLine(w http.ResponseWriter, r *http.Request) {
	var in updateCartLineDTO
	if !decodeStrict(w, r, &in) {
		return
	}
	if in.Quantity < 1 || in.Quantity > 20 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"quantity must be 1..20; removal is DELETE.", nil)
		return
	}
	lineID := chi.URLParam(r, "lineId")
	c, err := h.store.UpdateCartLineQuantity(r.Context(), h.accountID(r), lineID, in.Quantity)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, cartToDTO(c))
}

func (h *Handler) RemoveCartLine(w http.ResponseWriter, r *http.Request) {
	lineID := chi.URLParam(r, "lineId")
	c, err := h.store.RemoveCartLine(r.Context(), h.accountID(r), lineID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, cartToDTO(c))
}

func (h *Handler) ClearCart(w http.ResponseWriter, r *http.Request) {
	if err := h.store.ClearCart(r.Context(), h.accountID(r)); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- Quote ----

func (h *Handler) CreateQuote(w http.ResponseWriter, r *http.Request) {
	var in quoteInputDTO
	if !decodeStrict(w, r, &in) {
		return
	}
	if in.CartID == "" || (in.Fulfilment != "DELIVERY" && in.Fulfilment != "PICKUP") {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"cart_id and a valid fulfilment are required.", nil)
		return
	}
	if in.ScheduledFor != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"scheduled_for must be null at V0.", nil)
		return
	}
	var tip int64
	if in.TipCents != nil {
		tip = *in.TipCents
		if tip < 0 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, "tip_cents must be non-negative.", nil)
			return
		}
	}
	req := QuoteRequest{
		AccountID: h.accountID(r), CartID: in.CartID, DeliveryAddressID: in.DeliveryAddressID,
		Fulfilment: in.Fulfilment, TipCents: tip, PromoCode: in.PromoCode,
	}
	q, err := h.store.CreateQuote(r.Context(), req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, quoteToDTO(q))
}

func (h *Handler) GetQuote(w http.ResponseWriter, r *http.Request) {
	quoteID := chi.URLParam(r, "quoteId")
	q, err := h.store.GetQuote(r.Context(), h.accountID(r), quoteID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, quoteToDTO(q))
}

// ---- Order ----

func (h *Handler) CreateOrder(w http.ResponseWriter, r *http.Request) {
	var in orderInputDTO
	if !decodeStrict(w, r, &in) {
		return
	}
	if in.QuoteID == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, "quote_id is required.", nil)
		return
	}
	save := false
	if in.SavePaymentMethod != nil {
		save = *in.SavePaymentMethod
	}
	oi := OrderInput{
		AccountID: h.accountID(r), QuoteID: in.QuoteID, PaymentMethodID: in.PaymentMethodID,
		SavePaymentMethod: save, DeliveryInstructions: in.DeliveryInstructions, SpecialInstructions: in.SpecialInstructions,
	}

	var freshQuote *Quote
	prepared, err := h.store.CreateOrder(r.Context(), oi, &freshQuote)
	if err != nil {
		if errors.Is(err, ErrQuoteStale) && freshQuote != nil {
			httpx.Fail(w, r, http.StatusConflict, codeQuoteStale,
				"The price changed since this quote was created. Please review and re-confirm.",
				map[string]any{"quote": quoteToDTO(freshQuote)})
			return
		}
		h.fail(w, r, err)
		return
	}

	// Ask the payment gateway for the PaymentIntent (P-16 step 3/4). The order
	// row already exists in CREATED under its deadline; if the gateway is not
	// wired we answer 503 honestly and mark the order FAILED rather than
	// fabricating a client_secret.
	res, gwErr := h.gateway.CreateOrderIntent(r.Context(), CreateIntentInput{
		OrderID: prepared.OrderID, OrderCode: prepared.OrderCode, QuoteID: prepared.QuoteID,
		AccountID: h.accountID(r), RestaurantID: prepared.RestaurantID,
		AmountCents: prepared.TotalCents, Currency: "CAD",
		PaymentMethodID: in.PaymentMethodID, SavePaymentMethod: save,
	})
	if gwErr != nil {
		h.log.Error("payment gateway failed for created order",
			slog.String("order_id", prepared.OrderID), slog.String("error", gwErr.Error()))
		// Fail the order to a terminal state so no CREATED order sits without a PI.
		_ = h.store.Transition(r.Context(), TransitionRequest{
			OrderID: prepared.OrderID, To: "FAILED", Actor: "SYSTEM", Reason: "payment gateway unavailable",
		})
		httpx.Fail(w, r, http.StatusServiceUnavailable, httpx.CodeServiceUnavailable,
			"Payment could not be initialised. No charge was made and the order was not placed.", nil)
		return
	}

	view, err := h.store.GetOrderForCustomer(r.Context(), h.accountID(r), prepared.OrderID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusCreated, orderCreatedDTO{
		Order: orderViewToDTO(view), ClientSecret: res.ClientSecret,
	})
}

func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	v, err := h.store.GetOrderForCustomer(r.Context(), h.accountID(r), orderID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, orderViewToDTO(v))
}

func (h *Handler) GetActiveOrder(w http.ResponseWriter, r *http.Request) {
	v, err := h.store.GetActiveOrder(r.Context(), h.accountID(r))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if v == nil {
		httpx.Respond(w, r, http.StatusOK, nil)
		return
	}
	httpx.Respond(w, r, http.StatusOK, orderViewToDTO(v))
}

func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	var cursor *time.Time
	if c := r.URL.Query().Get("cursor"); c != "" {
		if t, err := time.Parse(time.RFC3339Nano, c); err == nil {
			cursor = &t
		}
	}
	statusGroup := r.URL.Query().Get("status_group")
	items, next, err := h.store.ListOrders(r.Context(), h.accountID(r), statusGroup, limit, cursor)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	dtos := make([]orderSummaryDTO, 0, len(items))
	for _, o := range items {
		dtos = append(dtos, orderSummaryToDTO(o))
	}
	var nextCursor *string
	if next != nil {
		s := next.UTC().Format(time.RFC3339Nano)
		nextCursor = &s
	}
	httpx.RespondList(w, r, http.StatusOK, dtos, httpx.Meta{NextCursor: nextCursor, HasMore: next != nil})
}

func (h *Handler) CancelOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	var in orderCancellationInputDTO
	if !decodeStrict(w, r, &in) {
		return
	}
	if in.ReasonCode == "" {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, "reason_code is required.", nil)
		return
	}
	if in.ReasonCode == "OTHER" && (in.Note == nil || len(*in.Note) < 5) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed, "note is required when reason_code is OTHER.", nil)
		return
	}
	v, err := h.store.CancelOrder(r.Context(), h.accountID(r), orderID, in.ReasonCode, in.Note)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, orderViewToDTO(v))
}

// ---- getOrderTracking ----

func (h *Handler) GetOrderTracking(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	ot, err := h.store.GetOrderTracking(r.Context(), h.accountID(r), orderID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, orderTrackingToDTO(ot))
}

// ---- getOrderReceipt ----

func (h *Handler) GetOrderReceipt(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	raw, err := h.store.GetOrderReceipt(r.Context(), h.accountID(r), orderID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	// The snapshot is a frozen JSONB blob; unmarshal → re-marshal through the
	// typed DTO to ensure the wire shape matches the contract exactly, with no
	// extra fields leaking.
	var snap receiptSnapshotDTO
	if err := json.Unmarshal(raw, &snap); err != nil {
		h.log.Error("receipt_snapshot unmarshal", slog.String("order_id", orderID), slog.String("error", err.Error()))
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "Receipt could not be decoded.", nil)
		return
	}
	// The contract types refunds/tax_lines/addons as non-nullable arrays. A frozen
	// snapshot that omits any of them (or stores null) must still render `[]`.
	snap.normalizeArrays()
	httpx.Respond(w, r, http.StatusOK, snap)
}

// ---- getOrderRiderPublicProfile ----

func (h *Handler) GetOrderRiderPublicProfile(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	rp, err := h.store.GetRiderPublicProfile(r.Context(), h.accountID(r), orderID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, riderPublicProfileToDTO(rp))
}

// fail maps a store error to the contract ErrorCode and HTTP status.
func (h *Handler) fail(w http.ResponseWriter, r *http.Request, err error) {
	var taxMissing *pricing.TaxProfileMissing
	var illegal *IllegalTransitionError
	switch {
	case errors.Is(err, ErrCartNotFound), errors.Is(err, ErrOrderNotFound), errors.Is(err, ErrQuoteNotFound):
		httpx.Fail(w, r, http.StatusNotFound, codeNotFound, "No such resource.", nil)
	case errors.Is(err, ErrReceiptNotReady):
		httpx.Fail(w, r, http.StatusConflict, codeReceiptNotReady, "This order does not have a receipt yet.", nil)
	case errors.Is(err, ErrDifferentRestaurant):
		httpx.Fail(w, r, http.StatusConflict, codeDifferentRestaurant,
			"Your cart contains items from a different restaurant. Start a new cart to add this item.", nil)
	case errors.Is(err, ErrItemUnavailable):
		httpx.Fail(w, r, http.StatusConflict, codeItemUnavailable, "An item is no longer available.", nil)
	case errors.Is(err, ErrOrderingPaused):
		httpx.Fail(w, r, http.StatusConflict, codeOrderingPaused,
			"Ordering is paused on HalalGoes right now. Nothing was charged; please try again later.", nil)
	case errors.Is(err, ErrRestaurantClosed):
		httpx.Fail(w, r, http.StatusConflict, codeRestaurantClosed, "The restaurant is not accepting orders right now.", nil)
	case errors.Is(err, ErrCartEmpty):
		httpx.Fail(w, r, http.StatusConflict, codeCartHasUnavailable, "The cart is empty.", nil)
	case errors.Is(err, ErrProvinceNotServed):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeProvinceNotServed, "We do not serve that province yet.", nil)
	case errors.As(err, &taxMissing):
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeTaxProfileMissing,
			"No effective tax rate is configured for this location.", nil)
	case errors.Is(err, ErrQuoteExpired):
		httpx.Fail(w, r, http.StatusConflict, codeQuoteExpired, "This quote has expired. Please request a new one.", nil)
	case errors.Is(err, ErrActiveOrderExists):
		httpx.Fail(w, r, http.StatusConflict, codeActiveOrderExists, "You already have an active order.", nil)
	case errors.Is(err, ErrCancellationWindowClosed):
		httpx.Fail(w, r, http.StatusConflict, codeCancellationClosed,
			"This order can no longer be cancelled from the app. Please contact support.", nil)
	case errors.Is(err, ErrReviewWindowClosed):
		httpx.Fail(w, r, http.StatusConflict, codeReviewWindowClosed,
			"This order cannot be rated (not yet delivered, no rider assigned, or the 14-day window has closed).", nil)
	case errors.Is(err, ErrReviewEditWindowClosed):
		httpx.Fail(w, r, http.StatusConflict, codeReviewEditWindowClosed,
			"This rating was submitted more than 24 hours ago and can no longer be edited.", nil)
	case errors.As(err, &illegal):
		allowed := make([]string, 0, len(illegal.Allowed))
		for _, s := range illegal.Allowed {
			allowed = append(allowed, string(s))
		}
		httpx.Fail(w, r, http.StatusConflict, codeIllegalTransition, "That state change is not allowed.",
			map[string]any{"from": string(illegal.From), "to": string(illegal.To), "allowed": allowed})
	default:
		h.log.Error("orders internal error", slog.String("error", err.Error()))
		httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError, "The server failed to process this request.", nil)
	}
}
