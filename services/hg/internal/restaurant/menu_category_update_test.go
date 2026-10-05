package restaurant_test

// updateMenuCategory (https://github.com/shaiknoorullah/hg-mono/issues/502): a
// restaurant renames, reorders, deactivates or reactivates its own category
// (docs/spec/03-restaurant.md, R-14 "Menu and category management").

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/restaurant"
)

func patchCategory(h *restaurant.Handler, f fixtures, categoryID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/v1/restaurant/menu/categories/"+categoryID, strings.NewReader(body))
	return serveAsOwner(h.UpdateMenuCategory, withChiParam(req, "categoryId", categoryID), f)
}

// Moving a category rewrites the whole menu's order as a dense 0..n-1 sequence;
// a name another category already uses, in any case, is 409 and changes nothing;
// another restaurant's category is 404, never 403.
func TestIntegration_UpdateMenuCategory(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	ctx := context.Background()

	// The fixture's "Mains" (sort_order 0) plus Starters and Desserts, with gaps.
	var starters, desserts, foreign string
	if err := pool.QueryRow(ctx, `INSERT INTO menu_category (restaurant_id, name, sort_order)
		VALUES ($1, 'Starters', 5) RETURNING id`, f.restaurantID).Scan(&starters); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO menu_category (restaurant_id, name, sort_order)
		VALUES ($1, 'Desserts', 9) RETURNING id`, f.restaurantID).Scan(&desserts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO menu_category (restaurant_id, name)
		VALUES ($1, 'Theirs') RETURNING id`, f.otherRestID).Scan(&foreign); err != nil {
		t.Fatal(err)
	}

	order := func() []string {
		rows, err := pool.Query(ctx, `SELECT name || ':' || sort_order FROM menu_category
			WHERE restaurant_id = $1 AND deleted_at IS NULL ORDER BY sort_order`, f.restaurantID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				t.Fatal(err)
			}
			out = append(out, s)
		}
		return out
	}

	// Desserts to the front, renamed and deactivated in the same save.
	rec := patchCategory(h, f, desserts, `{"name":"Sweets","sort_order":0,"is_active":false}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: status=%d (%s)", rec.Code, rec.Body.String())
	}
	var got struct {
		Data struct {
			Name      string `json:"name"`
			SortOrder int    `json:"sort_order"`
			IsActive  bool   `json:"is_active"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Data.Name != "Sweets" || got.Data.SortOrder != 0 || got.Data.IsActive {
		t.Errorf("response = %+v, want Sweets at 0, inactive", got.Data)
	}
	if want, have := "Sweets:0,Mains:1,Starters:2", strings.Join(order(), ","); have != want {
		t.Errorf("order = %s, want %s", have, want)
	}

	// A position past the end is the end.
	if rec := patchCategory(h, f, desserts, `{"sort_order":99}`); rec.Code != http.StatusOK {
		t.Fatalf("move to end: status=%d (%s)", rec.Code, rec.Body.String())
	}
	if want, have := "Mains:0,Starters:1,Sweets:2", strings.Join(order(), ","); have != want {
		t.Errorf("order = %s, want %s", have, want)
	}

	// "starters" is taken by Starters, ignoring case.
	if rec := patchCategory(h, f, desserts, `{"name":"starters"}`); rec.Code != http.StatusConflict ||
		!strings.Contains(rec.Body.String(), "CATEGORY_NAME_TAKEN") {
		t.Errorf("duplicate name: status=%d (%s), want 409 CATEGORY_NAME_TAKEN", rec.Code, rec.Body.String())
	}

	// Another restaurant's category is invisible.
	if rec := patchCategory(h, f, foreign, `{"name":"Mine now"}`); rec.Code != http.StatusNotFound {
		t.Errorf("foreign category: status=%d (%s), want 404", rec.Code, rec.Body.String())
	}
	var foreignName string
	if err := pool.QueryRow(ctx, `SELECT name FROM menu_category WHERE id = $1`, foreign).Scan(&foreignName); err != nil {
		t.Fatal(err)
	}
	if foreignName != "Theirs" {
		t.Errorf("foreign category renamed to %q", foreignName)
	}
}
