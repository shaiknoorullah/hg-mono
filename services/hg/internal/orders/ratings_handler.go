package orders

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ---- wire DTOs (contract: FoodRating, RiderRating, OrderRating, OrderRatingInput) ----

type foodRatingDTO struct {
	OrderID      string   `json:"order_id"`
	RestaurantID string   `json:"restaurant_id"`
	Score        int      `json:"score"`
	Review       *string  `json:"review"`
	Tags         []string `json:"tags"`
	Status       string   `json:"status"`
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
}

type riderRatingDTO struct {
	OrderID   string   `json:"order_id"`
	Score     int      `json:"score"`
	Comment   *string  `json:"comment"`
	Tags      []string `json:"tags"`
	Status    string   `json:"status"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

type orderRatingDTO struct {
	OrderID string          `json:"order_id"`
	Food    *foodRatingDTO  `json:"food"`
	Rider   *riderRatingDTO `json:"rider"`
}

// orderRatingInputDTO mirrors OrderRatingInput exactly; the two nested shapes
// carry different text-field names (review vs comment) so they are decoded
// separately rather than sharing ratingTargetInputDTO.
type orderRatingInputDTO struct {
	Food *struct {
		Score  int      `json:"score"`
		Review *string  `json:"review"`
		Tags   []string `json:"tags"`
	} `json:"food"`
	Rider *struct {
		Score   int      `json:"score"`
		Comment *string  `json:"comment"`
		Tags    []string `json:"tags"`
	} `json:"rider"`
}

func foodRatingToDTO(f *foodRatingRow) *foodRatingDTO {
	if f == nil {
		return nil
	}
	tags := f.Tags
	if tags == nil {
		tags = []string{}
	}
	return &foodRatingDTO{
		OrderID: f.OrderID, RestaurantID: f.RestaurantID, Score: f.Score,
		Review: f.Review, Tags: tags, Status: f.Status,
		CreatedAt: httpx.Timestamp(f.CreatedAt), UpdatedAt: httpx.Timestamp(f.UpdatedAt),
	}
}

func riderRatingToDTO(rr *riderRatingRow) *riderRatingDTO {
	if rr == nil {
		return nil
	}
	tags := rr.Tags
	if tags == nil {
		tags = []string{}
	}
	return &riderRatingDTO{
		OrderID: rr.OrderID, Score: rr.Score, Comment: rr.Comment, Tags: tags, Status: rr.Status,
		CreatedAt: httpx.Timestamp(rr.CreatedAt), UpdatedAt: httpx.Timestamp(rr.UpdatedAt),
	}
}

// GetOrderRating implements GET /v1/orders/{orderId}/rating.
func (h *Handler) GetOrderRating(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	food, rider, err := h.store.GetOrderRating(r.Context(), h.accountID(r), orderID)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, orderRatingDTO{
		OrderID: orderID, Food: foodRatingToDTO(food), Rider: riderRatingToDTO(rider),
	})
}

// SubmitOrderRating implements PUT /v1/orders/{orderId}/rating.
func (h *Handler) SubmitOrderRating(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "orderId")
	var in orderRatingInputDTO
	if !decodeStrict(w, r, &in) {
		return
	}
	if in.Food == nil && in.Rider == nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
			"At least one of food or rider must be provided.",
			[]httpx.FieldError{{Field: "food", Code: "required", Message: "provide food and/or rider"}})
		return
	}
	var food, rider *ratingInput
	if in.Food != nil {
		if in.Food.Score < 1 || in.Food.Score > 5 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
				"food.score must be 1..5.", []httpx.FieldError{{Field: "food.score", Code: "range", Message: "must be 1..5"}})
			return
		}
		food = &ratingInput{Score: in.Food.Score, Text: in.Food.Review, Tags: in.Food.Tags}
	}
	if in.Rider != nil {
		if in.Rider.Score < 1 || in.Rider.Score > 5 {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, codeValidationFailed,
				"rider.score must be 1..5.", []httpx.FieldError{{Field: "rider.score", Code: "range", Message: "must be 1..5"}})
			return
		}
		rider = &ratingInput{Score: in.Rider.Score, Text: in.Rider.Comment, Tags: in.Rider.Tags}
	}

	f, rr, err := h.store.SubmitOrderRating(r.Context(), h.accountID(r), orderID, food, rider)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, orderRatingDTO{
		OrderID: orderID, Food: foodRatingToDTO(f), Rider: riderRatingToDTO(rr),
	})
}
