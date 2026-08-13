package admin

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// validMenuDecision is the closed set of allowed decision values.
var validMenuDecision = map[string]bool{"APPROVE": true, "REJECT": true}

// validRejectionReasonCode is the closed set from the contract enum.
var validRejectionReasonCode = map[string]bool{
	"MISLEADING_DESCRIPTION":      true,
	"UNSUBSTANTIATED_HALAL_CLAIM": true,
	"INCORRECT_DIETARY_TAG":       true,
	"MISSING_ALLERGEN":            true,
	"POOR_IMAGE_QUALITY":          true,
	"IMAGE_NOT_OF_DISH":           true,
	"PROHIBITED_ITEM":             true,
	"OFFENSIVE_CONTENT":           true,
	"OTHER":                       true,
}

const (
	menuPriceMin int64 = 50
	menuPriceMax int64 = 50000
)

// CreateMenuCategoryOnBehalf implements createMenuCategoryOnBehalf (A-19).
// POST /v1/admin/restaurants/{restaurantId}/menu/categories
func (h *Handler) CreateMenuCategoryOnBehalf(w http.ResponseWriter, r *http.Request) {
	restaurantID := chi.URLParam(r, "restaurantId")

	var in menuCategoryInput
	if !decodeJSON(w, r, &in) {
		return
	}

	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		fieldFail(w, r, "name", "name is required")
		return
	}

	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}

	row, err := h.repo.CreateMenuCategoryOnBehalf(r.Context(), actorFrom(r),
		restaurantID, in.Name, in.Description, sortOrder)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound,
				"Restaurant not found.", nil)
			return
		}
		if errors.Is(err, ErrCategoryNameTaken) {
			httpx.Fail(w, r, http.StatusConflict, CodeCategoryNameTaken,
				"A category with this name already exists for this restaurant.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}

	httpx.Respond(w, r, http.StatusCreated, menuCategory{
		ID:           row.ID,
		RestaurantID: row.RestaurantID,
		Name:         row.Name,
		Description:  row.Description,
		SortOrder:    row.SortOrder,
		IsActive:     row.IsActive,
		CreatedAt:    httpx.Timestamp(row.CreatedAt),
		UpdatedAt:    httpx.Timestamp(row.UpdatedAt),
	})
}

// CreateMenuItemOnBehalf implements createMenuItemOnBehalf (A-19).
// POST /v1/admin/restaurants/{restaurantId}/menu/items
// Admin-created items are immediately approved (reviewer == author).
func (h *Handler) CreateMenuItemOnBehalf(w http.ResponseWriter, r *http.Request) {
	restaurantID := chi.URLParam(r, "restaurantId")

	var in menuItemInput
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

	// Price validation: [50, 50000] cents.
	if in.PriceCents < menuPriceMin || in.PriceCents > menuPriceMax {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodePriceOutOfRange,
			"price_cents must be between 50 and 50000.", []httpx.FieldError{
				{Field: "price_cents", Code: "PRICE_OUT_OF_RANGE", Message: "price_cents must be between 50 and 50000"},
			})
		return
	}

	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		fieldFail(w, r, "name", "name is required")
		return
	}

	taxCategory := "PREPARED_FOOD"
	if in.TaxCategory != nil && *in.TaxCategory != "" {
		taxCategory = *in.TaxCategory
	}

	dietaryTags := in.DietaryTags
	if dietaryTags == nil {
		dietaryTags = []string{}
	}
	allergenTags := in.AllergenTags
	if allergenTags == nil {
		allergenTags = []string{}
	}

	row, err := h.repo.CreateMenuItemOnBehalf(r.Context(), actorFrom(r),
		restaurantID, in.CategoryID, in.PriceCents, in.Name, in.Description,
		dietaryTags, allergenTags, taxCategory)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound,
				"Restaurant or category not found.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}

	out := menuItemOwnerView{
		ID:                row.ID,
		RestaurantID:      row.RestaurantID,
		CategoryID:        row.CategoryID,
		PriceCents:        row.PriceCents,
		Currency:          row.Currency,
		AvailabilityState: row.AvailabilityState,
		TaxCategory:       row.TaxCategory,
		SortOrder:         row.SortOrder,
		Name:              in.Name,
		Description:       in.Description,
	}
	if row.LiveVersionID != nil {
		lv := &menuItemVersion{
			ID:           *row.LiveVersionID,
			MenuItemID:   row.ID,
			RestaurantID: row.RestaurantID,
			Version:      1,
			Name:         in.Name,
			ReviewStatus: "APPROVED",
			DietaryTags:  dietaryTags,
			AllergenTags: allergenTags,
			Description:  row.LiveVersionDescription,
			CreatedAt:    httpx.Timestamp(row.CreatedAt),
		}
		if row.LiveVersionName != nil {
			lv.Name = *row.LiveVersionName
		}
		if lv.Description == nil {
			lv.Description = in.Description
		}
		if lv.DietaryTags == nil {
			lv.DietaryTags = []string{}
		}
		if lv.AllergenTags == nil {
			lv.AllergenTags = []string{}
		}
		if row.LiveVersionReviewedAt != nil {
			lv.ReviewedAt = ptr(httpx.Timestamp(*row.LiveVersionReviewedAt))
		}
		out.LiveVersion = lv
	}
	// Admin-created items have no pending version.
	out.PendingVersion = nil

	httpx.Respond(w, r, http.StatusCreated, out)
}

// ListMenuReviewQueue implements listMenuReviewQueue (A-19).
// GET /v1/admin/menu-reviews
func (h *Handler) ListMenuReviewQueue(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r)

	var restaurantID *string
	if rid := r.URL.Query().Get("restaurant_id"); rid != "" {
		restaurantID = &rid
	}

	cur, curID, ok := decodeTimeCursor(r)
	if !ok {
		fieldFail(w, r, "cursor", "malformed cursor")
		return
	}

	rows, err := h.repo.ListMenuReviewQueue(r.Context(), restaurantID, limit+1, cur, curID)
	if err != nil {
		h.failInternal(w, r, err)
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	out := make([]menuItemVersion, 0, len(rows))
	for _, v := range rows {
		out = append(out, renderMenuItemVersion(v))
	}

	meta := httpx.Meta{HasMore: hasMore}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		if last.SubmittedAt != nil {
			meta.NextCursor = ptr(encodeTimeCursor(*last.SubmittedAt, last.ID))
		}
	}

	httpx.RespondList(w, r, http.StatusOK, out, meta)
}

// DecideMenuVersion implements decideMenuVersion (A-19).
// POST /v1/admin/menu-reviews/{versionId}/decision
func (h *Handler) DecideMenuVersion(w http.ResponseWriter, r *http.Request) {
	versionID := chi.URLParam(r, "versionId")

	var in menuDecisionInput
	if !decodeJSON(w, r, &in) {
		return
	}

	if !validMenuDecision[in.Decision] {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
			"decision must be APPROVE or REJECT.",
			[]httpx.FieldError{{Field: "decision", Code: "invalid", Message: "must be APPROVE or REJECT"}})
		return
	}

	if in.Decision == "REJECT" {
		if in.ReasonCode == nil || *in.ReasonCode == "" {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
				"reason_code is required when decision is REJECT.",
				[]httpx.FieldError{{Field: "reason_code", Code: "required", Message: "required for REJECT"}})
			return
		}
		if !validRejectionReasonCode[*in.ReasonCode] {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
				"invalid reason_code.",
				[]httpx.FieldError{{Field: "reason_code", Code: "invalid", Message: "unknown reason code"}})
			return
		}
	}

	result, err := h.repo.DecideMenuVersion(r.Context(), actorFrom(r),
		versionID, in.Decision, in.ReasonCode, in.ReviewNote)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Fail(w, r, http.StatusNotFound, CodeNotFound,
				"Menu version not found.", nil)
			return
		}
		if errors.Is(err, ErrAlreadyDecided) {
			httpx.Fail(w, r, http.StatusConflict, CodeAlreadyDecided,
				"This version has already been decided.", nil)
			return
		}
		if errors.Is(err, ErrItemDeleted) {
			httpx.Fail(w, r, http.StatusConflict, CodeItemDeleted,
				"The menu item has been deleted.", nil)
			return
		}
		h.failInternal(w, r, err)
		return
	}

	out := menuItemVersion{
		ID:                  result.ID,
		MenuItemID:          result.MenuItemID,
		RestaurantID:        result.RestaurantID,
		Version:             result.Version,
		Name:                result.Name,
		Description:         result.Description,
		DietaryTags:         result.DietaryTags,
		AllergenTags:        result.AllergenTags,
		ReviewStatus:        result.ReviewStatus,
		RejectionReasonCode: result.RejectionReasonCode,
		ReviewNote:          result.ReviewNote,
		SubmittedAt:         tsPtr(result.SubmittedAt),
		ReviewedAt:          tsPtr(result.ReviewedAt),
		CreatedAt:           httpx.Timestamp(result.CreatedAt),
	}
	if out.DietaryTags == nil {
		out.DietaryTags = []string{}
	}
	if out.AllergenTags == nil {
		out.AllergenTags = []string{}
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// renderMenuItemVersion converts a menuItemVersionRow to a menuItemVersion DTO.
func renderMenuItemVersion(v menuItemVersionRow) menuItemVersion {
	out := menuItemVersion{
		ID:                  v.ID,
		MenuItemID:          v.MenuItemID,
		RestaurantID:        v.RestaurantID,
		Version:             v.Version,
		Name:                v.Name,
		Description:         v.Description,
		DietaryTags:         v.DietaryTags,
		AllergenTags:        v.AllergenTags,
		ReviewStatus:        v.ReviewStatus,
		RejectionReasonCode: v.RejectionReasonCode,
		ReviewNote:          v.ReviewNote,
		SubmittedAt:         tsPtr(v.SubmittedAt),
		ReviewedAt:          tsPtr(v.ReviewedAt),
		CreatedAt:           httpx.Timestamp(v.CreatedAt),
	}
	if out.DietaryTags == nil {
		out.DietaryTags = []string{}
	}
	if out.AllergenTags == nil {
		out.AllergenTags = []string{}
	}
	return out
}
