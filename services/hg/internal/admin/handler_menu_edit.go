package admin

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

// UpdateMenuItemOnBehalf implements updateMenuItemOnBehalf (A-19).
// PATCH /v1/admin/restaurants/{restaurantId}/menu/items/{itemId}
// The same guardrails as createMenuItemOnBehalf; claim-bearing fields are
// approved on save, and a restaurant edit waiting for review is a 409, never
// overwritten.
func (h *Handler) UpdateMenuItemOnBehalf(w http.ResponseWriter, r *http.Request) {
	restaurantID := chi.URLParam(r, "restaurantId")
	itemID := chi.URLParam(r, "itemId")

	var in menuItemUpdateInput
	if !decodeJSON(w, r, &in) {
		return
	}

	// HALAL_CERTIFIED is platform-derived — callers may not assert it (R-05).
	for _, tag := range in.DietaryTags {
		if tag == "HALAL_CERTIFIED" {
			httpx.Fail(w, r, http.StatusForbidden, CodeFieldNotWritable,
				"HALAL_CERTIFIED is platform-derived and may not be set by callers.", nil)
			return
		}
	}
	if in.CategoryID != nil && !isValidUUIDStr(*in.CategoryID) {
		fieldFail(w, r, "category_id", "category_id must be a UUID")
		return
	}
	if fe := validateMenuTags(in.DietaryTags, in.AllergenTags); len(fe) > 0 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeInvalidEnumValue,
			"One or more tags are not recognised.", fe)
		return
	}
	if in.PriceCents != nil && (*in.PriceCents < menuPriceMin || *in.PriceCents > menuPriceMax) {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodePriceOutOfRange,
			"price_cents must be between 50 and 50000.", []httpx.FieldError{
				{Field: "price_cents", Code: "PRICE_OUT_OF_RANGE", Message: "price_cents must be between 50 and 50000"},
			})
		return
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		in.Name = &name
		// Contract MenuItemUpdateInput: name minLength 2, maxLength 80.
		if n := runeLen(name); n < menuItemNameMin || n > menuItemNameMax {
			fieldFail(w, r, "name", "name must be between 2 and 80 characters")
			return
		}
	}
	if !menuItemOptionalFieldsOK(w, r, in.Description, in.IngredientsText, in.PrepMinutes, in.ImageObjectID) {
		return
	}

	// A malformed id names no item: the same 404 as one that does not exist,
	// rather than a uuid cast failing as a 500.
	if !isValidUUIDStr(restaurantID) || !isValidUUIDStr(itemID) {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "Menu item not found.", nil)
		return
	}

	row, err := h.repo.UpdateMenuItemOnBehalf(r.Context(), actorFrom(r), menuItemUpdate{
		restaurantID:      restaurantID,
		itemID:            itemID,
		categoryID:        in.CategoryID,
		priceCents:        in.PriceCents,
		prepMinutes:       in.PrepMinutes,
		sortOrder:         in.SortOrder,
		name:              in.Name,
		description:       in.Description,
		ingredientsText:   in.IngredientsText,
		dietaryTags:       in.DietaryTags,
		allergenTags:      in.AllergenTags,
		allergensDeclared: in.AllergensDeclared,
		imageObjectID:     in.ImageObjectID,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrUploadNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "No such upload.", nil)
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound,
				"Restaurant, menu item or category not found.", nil)
		case errors.Is(err, ErrMenuVersionPending):
			httpx.Fail(w, r, http.StatusConflict, CodeMenuVersionPending,
				"The restaurant has an edit to this item waiting for review. Decide it first.", nil)
		case errors.Is(err, ErrItemNameRequired):
			fieldFail(w, r, "name", "name is required: the item has no live version to keep it from")
		case restaurant.RespondMenuLocked(w, r, err):
		default:
			h.failInternal(w, r, err)
		}
		return
	}

	httpx.Respond(w, r, http.StatusOK, renderMenuItemOwnerView(row))
}

// DeleteMenuItemOnBehalf implements deleteMenuItemOnBehalf (A-19).
// DELETE /v1/admin/restaurants/{restaurantId}/menu/items/{itemId}
func (h *Handler) DeleteMenuItemOnBehalf(w http.ResponseWriter, r *http.Request) {
	restaurantID := chi.URLParam(r, "restaurantId")
	itemID := chi.URLParam(r, "itemId")
	if !isValidUUIDStr(restaurantID) || !isValidUUIDStr(itemID) {
		httpx.Fail(w, r, http.StatusNotFound, CodeNotFound, "Menu item not found.", nil)
		return
	}

	err := h.repo.DeleteMenuItemOnBehalf(r.Context(), actorFrom(r), restaurantID, itemID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound,
				"Restaurant or menu item not found.", nil)
		case restaurant.RespondMenuLocked(w, r, err):
		default:
			h.failInternal(w, r, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// renderMenuItemOwnerView is the contract's MenuItemOwnerView for an item read
// back after a write: the customer-facing fields come from the live version.
func renderMenuItemOwnerView(row menuItemFull) menuItemOwnerView {
	out := menuItemOwnerView{
		ID:                row.ID,
		RestaurantID:      row.RestaurantID,
		CategoryID:        row.CategoryID,
		PriceCents:        row.PriceCents,
		Currency:          row.Currency,
		AvailabilityState: row.AvailabilityState,
		TaxCategory:       row.TaxCategory,
		SortOrder:         row.SortOrder,
		OutOfStockUntil:   tsPtr(row.OutOfStockUntil),
		PrepMinutes:       row.PrepMinutes,
		ImageURL:          nil, // MediaResolver not wired in admin; null is contract-valid
		DietaryTags:       []string{},
		AllergenTags:      []string{},
	}
	if row.Live != nil {
		lv := renderMenuItemVersion(*row.Live)
		out.LiveVersion = &lv
		out.Name = lv.Name
		out.Description = lv.Description
		out.IngredientsText = lv.IngredientsText
		out.DietaryTags = lv.DietaryTags
		out.AllergenTags = lv.AllergenTags
	}
	if row.Pending != nil {
		pv := renderMenuItemVersion(*row.Pending)
		out.PendingVersion = &pv
	}
	return out
}
