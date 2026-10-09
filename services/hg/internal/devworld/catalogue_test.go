package devworld

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/openhours"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/orders"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/testseed"
)

// The two places a new customer is most likely to stand: the default address
// on the Danforth and downtown.
var customerPoints = [][2]float64{{43.6825, -79.3300}, {43.6500, -79.3800}}

const deliveryRadiusM = 8000 // restaurant.delivery_radius_m default

func metresBetween(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000.0
	p1, p2 := lat1*math.Pi/180, lat2*math.Pi/180
	dp, dl := (lat2-lat1)*math.Pi/180, (lng2-lng1)*math.Pi/180
	a := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

// TestCatalogueIsAMarketplace pins what the catalogue promises without a
// database: enough restaurants, in delivery range of both customer points,
// menus of a real size, and every photo attributed.
func TestCatalogueIsAMarketplace(t *testing.T) {
	photos, err := PhotoManifest()
	if err != nil {
		t.Fatal(err)
	}
	for key, p := range photos {
		if p.Author == "" || p.Licence == "" || !strings.HasPrefix(p.Page, "https://commons.wikimedia.org/") ||
			!strings.HasPrefix(p.URL, "https://") {
			t.Errorf("photo %s is not fully attributed: %+v", key, p)
		}
	}
	if n := len(Catalogue); n < 12 || n > 16 {
		t.Fatalf("catalogue has %d restaurants, want 12–16", n)
	}
	slugs := map[string]bool{}
	for _, r := range Catalogue {
		if slugs[r.Slug] || slugs[r.ID] {
			t.Errorf("%s: duplicate slug or id", r.Slug)
		}
		slugs[r.Slug], slugs[r.ID] = true, true
		for _, pt := range customerPoints {
			if d := metresBetween(r.Lat, r.Lng, pt[0], pt[1]); d > deliveryRadiusM {
				t.Errorf("%s is %.0f m from %v, beyond the %d m delivery radius", r.Slug, d, pt, deliveryRadiusM)
			}
		}
		if _, ok := photos[r.Hero]; !ok {
			t.Errorf("%s: hero photo %q is not in the manifest", r.Slug, r.Hero)
		}
		if n := len(r.Categories); n < 3 || n > 6 {
			t.Errorf("%s has %d categories, want 3–6", r.Slug, n)
		}
		keys := map[string]bool{}
		count := 0
		for _, c := range r.Categories {
			for _, it := range c.Items {
				count++
				if keys[it.Key] {
					t.Errorf("%s: duplicate item key %s", r.Slug, it.Key)
				}
				keys[it.Key] = true
				if it.Cents <= 0 {
					t.Errorf("%s/%s: price %d", r.Slug, it.Key, it.Cents)
				}
				if _, ok := photos[it.Photo]; it.Photo != "" && !ok {
					t.Errorf("%s/%s: photo %q is not in the manifest", r.Slug, it.Key, it.Photo)
				}
				if v := it.Variants; v != nil && (len(v.Options) < 2 || v.Options[0].Off) {
					t.Errorf("%s/%s: a variant group needs two options and an available default", r.Slug, it.Key)
				}
				for _, g := range it.Addons {
					if available(g.Options) < g.Min || g.Max < g.Min {
						t.Errorf("%s/%s: add-on group %q cannot be satisfied", r.Slug, it.Key, g.Name)
					}
				}
			}
		}
		if count < 12 || count > 25 {
			t.Errorf("%s has %d items, want 12–25", r.Slug, count)
		}
	}
	// The scenarios order this item by its fixed id.
	if !hasItemID(itemChickenKarahi) {
		t.Error("the catalogue no longer carries the scenario's chicken karahi id")
	}
}

func available(opts []Opt) int {
	n := 0
	for _, o := range opts {
		if !o.Off {
			n++
		}
	}
	return n
}

func hasItemID(id string) bool {
	for _, r := range Catalogue {
		for _, c := range r.Categories {
			for _, it := range c.Items {
				if it.ID == id {
					return true
				}
			}
		}
	}
	return false
}

// TestIntegrationCatalogueIsOrderable seeds the world into a fresh database and
// quotes every available item of every catalogue restaurant that takes orders,
// through the same store the cart and quote endpoints use. It proves each one
// is visible to customers, carries a verified certificate, and is priced by the
// server to the cent the menu says.
func TestIntegrationCatalogueIsOrderable(t *testing.T) {
	dsn := testseed.FreshDatabase(t, "hg_devworld_catalogue")
	ctx := context.Background()
	if err := ApplyPersonas(ctx, dsn); err != nil {
		t.Fatal(err)
	}
	if err := ApplyCatalogue(ctx, dsn); err != nil {
		t.Fatal(err)
	}
	if err := ApplyCatalogue(ctx, dsn); err != nil {
		t.Fatalf("a second run must be a no-op: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	st := orders.NewStore(pool)
	const amina, aminaAddress = "a0000000-0000-4000-8000-000000000101", addressAminaNear
	quoted, closed := 0, 0

	for _, r := range Catalogue {
		var halal, account string
		var accepting bool
		if err := pool.QueryRow(ctx, `SELECT halal_status::text, account_state::text, is_accepting_orders
		                                FROM restaurant WHERE id = $1`, r.ID).Scan(&halal, &account, &accepting); err != nil {
			t.Fatalf("%s: %v", r.Slug, err)
		}
		if account != "LIVE" || (halal != "CERTIFIED" && halal != "EXPIRING_SOON") {
			t.Errorf("%s is %s/%s: customers would not see it", r.Slug, account, halal)
			continue
		}
		if !accepting {
			continue // the paused persona: visible, not taking orders
		}
		// Some catalogue restaurants are closed by their hours (closed today, or
		// afternoons only before noon): the order path refuses them, by the
		// rule their card shows (https://github.com/shaiknoorullah/hg-mono/issues/648).
		var open openhours.Restaurant
		var now time.Time
		if err := pool.QueryRow(ctx, `SELECT now(), r.timezone, `+openhours.Columns+` FROM restaurant r WHERE r.id = $1`, r.ID).
			Scan(append([]any{&now, &open.Timezone}, open.ScanTargets()...)...); err != nil {
			t.Fatalf("%s: open state: %v", r.Slug, err)
		}
		if state, _ := open.State(now); state != openhours.StateOpen {
			in, _ := orderLine(r, firstAvailable(r))
			if _, err := st.AddCartLine(ctx, amina, r.ID, in, true); !errors.Is(err, orders.ErrRestaurantClosed) {
				t.Errorf("%s is %s: add to cart: err = %v, want ErrRestaurantClosed", r.Slug, state, err)
			}
			closed++
			continue
		}
		if r.Hours == hoursClosedToday {
			t.Errorf("%s has no hours today but reads open", r.Slug)
		}
		var want int64
		lines := 0
		for _, c := range r.Categories {
			for _, it := range c.Items {
				if it.OutOfStock {
					continue
				}
				in, unit := orderLine(r, it)
				if _, err := st.AddCartLine(ctx, amina, r.ID, in, lines == 0); err != nil {
					t.Fatalf("%s/%s: add to cart: %v", r.Slug, it.Key, err)
				}
				want += unit
				lines++
			}
		}
		cart, err := st.GetCart(ctx, amina)
		if err != nil {
			t.Fatal(err)
		}
		addr := aminaAddress
		q, err := st.CreateQuote(ctx, orders.QuoteRequest{
			AccountID: amina, CartID: cart.ID, DeliveryAddressID: &addr, Fulfilment: "DELIVERY",
		})
		if err != nil {
			t.Fatalf("%s: quote: %v", r.Slug, err)
		}
		if q.SubtotalCents != want {
			t.Errorf("%s: quoted subtotal %d for %d lines, menu says %d", r.Slug, q.SubtotalCents, lines, want)
		}
		quoted++
	}
	if quoted+closed < 12 || quoted < 10 {
		t.Errorf("%d catalogue restaurants quoted and %d closed by their hours, want at least 12 in all and 10 quoted",
			quoted, closed)
	}
}

// firstAvailable is the restaurant's first item that is in stock.
func firstAvailable(r CatalogueRestaurant) Item {
	for _, c := range r.Categories {
		for _, it := range c.Items {
			if !it.OutOfStock {
				return it
			}
		}
	}
	return Item{}
}

// orderLine picks the last available variant and the first available add-ons
// (enough for each required group, one from each optional group), and returns
// the unit price the menu promises for that choice.
func orderLine(r CatalogueRestaurant, it Item) (orders.CartLineInput, int64) {
	itemID, _ := r.ItemIDs(it)
	in := orders.CartLineInput{MenuItemID: itemID, Quantity: 1}
	unit := it.Cents
	if v := it.Variants; v != nil {
		pick := v.Options[0]
		for _, o := range v.Options {
			if !o.Off {
				pick = o
			}
		}
		id := catalogueID(r.Slug, "item", it.Key, "variant", pick.Name)
		in.VariantID = &id
		if v.Mode == "DELTA" {
			unit += pick.Cents
		} else {
			unit = pick.Cents
		}
	}
	for _, g := range it.Addons {
		n := g.Min
		if n == 0 {
			n = 1
		}
		for _, a := range g.Options {
			if n == 0 {
				break
			}
			if a.Off {
				continue
			}
			in.Addons = append(in.Addons, orders.CartAddonInput{
				AddonID: catalogueID(r.Slug, "item", it.Key, "addon", g.Name, a.Name), Quantity: 1})
			unit += a.Cents
			n--
		}
	}
	return in, unit
}
