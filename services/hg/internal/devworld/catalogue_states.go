package devworld

// State restaurants are the listed, certified restaurants the redesigned
// customer app needs in a state the marketplace catalogue (Catalogue) does not
// leave anyone in (issue #720). They are kept apart from Catalogue because that
// list promises a populated marketplace: every entry in range of both customer
// points, a menu of 12 to 25 dishes, and a test that orders from each.
//
// Like the catalogue, each has an owner who signs in as <slug>@seed.hg with the
// shared password, a certificate verified the way the personas' are (so the
// halal state is computed by the database trigger, never written), and weekly
// payout stand-ins. Names and addresses are invented.
//
//	last-light-bakehouse  no weekly hours: closed by its hours, whatever the time
//	rouge-valley-roti     in Scarborough, further than its delivery radius from
//	                      every address amina has (Home, Work and Cottage)
//	blank-slate-grill     open and in range, with no dish on its menu
//	lost-paper-diner      its certificate has no file behind it: the link is
//	                      minted, then the object store answers "no such key"
//
// Every other seeded certificate is a generated PDF (content type
// application/pdf), so the PDF case needs no restaurant of its own.
//
// What cannot be seeded: a certificate the API reports as not viewable
// (certificate_viewable false). The API says so only when it has no storage
// signer, a setting of the whole server, because a certificate always has its
// document (halal_certificate.document_id is NOT NULL). The missing-file
// restaurant is the nearest local state.

// StateRestaurants are the four restaurants described above.
var StateRestaurants = []CatalogueRestaurant{
	{
		Slug: "last-light-bakehouse", ID: "b0000000-0000-4000-8000-000000000401", OwnerID: "a0000000-0000-4000-8000-000000000401",
		Name:        "Last Light Bakehouse",
		Description: "A small Lebanese bakery on the Danforth. Its weekly hours are empty, so it reads closed at any time of day.",
		Cuisines:    []string{"middle-eastern"}, Tags: "manakish bakery zaatar",
		Line1: "1118 Danforth Avenue", PostalCode: "M4J 1M2", Lat: 43.6790, Lng: -79.3355,
		PriceBand: "$", Rating: 4.3, RatingCount: 41, PrepMinutes: 15, MinOrder: 1000, Hours: hoursNone,
		CertDays: 300, Body: 0, Palette: 2,
		Categories: []Category{
			cat("Manakish",
				item("zaatar", "Za'atar Manousheh", 599, "", "Flatbread baked with thyme, sesame and olive oil.", "wheat flour, thyme, sesame, olive oil", diet("VEGAN"), allergen("WHEAT_TRITICALE", "SESAME")),
				item("cheese", "Cheese Manousheh", 749, "", "Flatbread baked with akkawi cheese.", "wheat flour, akkawi cheese", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("lahm", "Lahm bi Ajeen", 899, "", "Minced beef and tomato on a thin crust.", "wheat flour, beef, tomato, onion", allergen("WHEAT_TRITICALE")),
			),
			cat("Drinks",
				item("tea", "Mint Tea", 249, "", "Black tea with fresh mint.", "black tea, mint", diet("VEGAN")),
			),
		},
	},
	{
		Slug: "rouge-valley-roti", ID: "b0000000-0000-4000-8000-000000000402", OwnerID: "a0000000-0000-4000-8000-000000000402",
		Name:        "Rouge Valley Roti",
		Description: "Caribbean-style roti in Rouge Hill, more than 18 km from the Danforth: out of range of every address in the dev world.",
		Cuisines:    []string{"indian"}, Tags: "roti curry doubles",
		Line1: "6 Port Union Road", PostalCode: "M1C 2L1", Lat: 43.7870, Lng: -79.1380,
		PriceBand: "$$", Rating: 4.4, RatingCount: 87, PrepMinutes: 25, MinOrder: 1200, Hours: hoursAllDay,
		CertDays: 300, Body: 1, Palette: 5,
		Categories: []Category{
			cat("Roti",
				item("chicken-roti", "Chicken Roti", 1399, "", "Curried chicken and potato in a soft dhalpuri roti.", "chicken, potato, split peas, wheat flour", allergen("WHEAT_TRITICALE"), spice(2)),
				item("chana-roti", "Chana Roti", 1199, "", "Curried chickpeas and potato in a dhalpuri roti.", "chickpeas, potato, wheat flour", diet("VEGAN"), allergen("WHEAT_TRITICALE"), spice(2)),
				item("doubles", "Doubles", 599, "", "Two fried flatbreads with curried chickpeas.", "wheat flour, chickpeas, tamarind", diet("VEGAN"), allergen("WHEAT_TRITICALE")),
			),
			cat("Drinks",
				item("sorrel", "Sorrel Drink", 399, "", "Chilled hibiscus drink with ginger.", "hibiscus, ginger, sugar", diet("VEGAN", "GLUTEN_FREE")),
			),
		},
	},
	{
		Slug: "blank-slate-grill", ID: "b0000000-0000-4000-8000-000000000403", OwnerID: "a0000000-0000-4000-8000-000000000403",
		Name:        "Blank Slate Grill",
		Description: "Open and in range, with nothing on its menu yet.",
		Cuisines:    []string{"middle-eastern"}, Tags: "grill",
		Line1: "790 Pape Avenue", PostalCode: "M4K 3S7", Lat: 43.6720, Lng: -79.3480,
		PriceBand: "$$", Rating: 4.0, RatingCount: 12, PrepMinutes: 20, MinOrder: 1000, Hours: hoursAllDay,
		CertDays: 300, Body: 0, Palette: 7,
	},
	{
		Slug: "lost-paper-diner", ID: "b0000000-0000-4000-8000-000000000404", OwnerID: "a0000000-0000-4000-8000-000000000404",
		Name:        "Lost Paper Diner",
		Description: "Certified, but the file behind its certificate is gone from the object store: \"View certificate\" cannot open it.",
		Cuisines:    []string{"middle-eastern"}, Tags: "diner breakfast",
		Line1: "1002 Gerrard Street East", PostalCode: "M4M 1Z9", Lat: 43.6700, Lng: -79.3410,
		PriceBand: "$$", Rating: 4.2, RatingCount: 63, PrepMinutes: 20, MinOrder: 1200, Hours: hoursAllDay,
		CertDays: 300, Body: 1, Palette: 9, CertFileMissing: true,
		Categories: []Category{
			cat("Breakfast",
				item("shakshuka", "Shakshuka", 1299, "", "Eggs poached in spiced tomato and pepper sauce, with bread.", "eggs, tomato, pepper, cumin, wheat bread", diet("VEGETARIAN"), allergen("EGGS", "WHEAT_TRITICALE"), spice(1)),
				item("foul", "Ful Medames", 1099, "", "Slow-cooked fava beans with lemon and olive oil.", "fava beans, lemon, olive oil, garlic", diet("VEGAN")),
			),
			cat("Drinks",
				item("coffee", "Arabic Coffee", 299, "", "Cardamom coffee in a small cup.", "coffee, cardamom", diet("VEGAN")),
			),
		},
	},
}

// AllRestaurants is every restaurant ApplyCatalogue seeds beyond the personas'
// own rows: the marketplace catalogue, then the state restaurants.
func AllRestaurants() []CatalogueRestaurant {
	all := make([]CatalogueRestaurant, 0, len(Catalogue)+len(StateRestaurants))
	all = append(all, Catalogue...)
	return append(all, StateRestaurants...)
}
