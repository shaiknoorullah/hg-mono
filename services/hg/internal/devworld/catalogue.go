package devworld

import (
	"github.com/google/uuid"
)

// The catalogue is the customer-facing half of the dev world: enough live,
// certified restaurants around Danforth and downtown Toronto that a new
// customer sees a populated marketplace after `make dev-reset`.
//
// Three entries are existing personas (bismillah-grill, expiring-halal,
// paused). Their accounts, certificates and the menu rows the scenarios use
// come from migrations/devworld/001_personas.sql; the catalogue only adds a
// profile, more menu and pictures. Every other entry is created here, with a
// certificate verified the same way the personas are, so the halal state is
// computed by the database triggers and never written by hand.
//
// Names, addresses and menus are invented. Money is int64 cents.

// Hours patterns.
const (
	hoursAllDay      = "all-day"      // 00:00–23:59 every day: open whenever someone tests
	hoursAfternoon   = "afternoon"    // 12:00–23:59 every day
	hoursClosedToday = "closed-today" // 11:00–22:00, no row for the reset day: closed by hours
)

// CatalogueRestaurant is one restaurant of the catalogue.
type CatalogueRestaurant struct {
	Slug    string
	ID      string
	OwnerID string // the RESTAURANT_OWNER account; <slug>@seed.hg
	Persona bool   // created by the persona SQL; the catalogue adds profile and menu only

	Name        string
	Description string
	Cuisines    []string // cuisine slugs from the reference seed
	Tags        string

	Line1      string
	PostalCode string
	Lat, Lng   float64

	PriceBand   string
	Rating      float64
	RatingCount int
	PrepMinutes int
	MinOrder    int64
	Hours       string

	// CertDays is how many days the certificate has left. Under 30 renders
	// EXPIRING_SOON; the trigger decides, not this number.
	CertDays int
	// Body picks one of the accepted issuing bodies, by name order.
	Body int

	Hero       string // photo key of the hero image
	Palette    int    // colour scheme for the generated logo and fallbacks
	Categories []Category
}

// Email is the owner's sign-in.
func (r CatalogueRestaurant) Email() string { return r.Slug + "@seed.hg" }

// Category is a menu section.
type Category struct {
	ID    string // set only for a category the persona SQL already inserted
	Name  string
	Items []Item
}

// Item is one dish.
type Item struct {
	ID        string // set only for an item the persona SQL already inserted
	VersionID string
	Key       string
	Name      string
	Desc      string
	Ingr      string
	Cents     int64
	Photo     string
	Diet      []string
	Allergens []string
	Spice     int
	Variants  *VariantGroup
	Addons    []AddonGroup
	// OutOfStock marks the item OUT_OF_STOCK; OutOfStockHours > 0 sets an
	// out_of_stock_until that far ahead, 0 means until restocked.
	OutOfStock      bool
	OutOfStockHours int
}

// VariantGroup is a required single choice that sets the price. The first
// option is the default.
type VariantGroup struct {
	Name    string
	Mode    string // ABSOLUTE replaces the base price, DELTA adjusts it
	Options []Opt
}

// AddonGroup is a choice of extras with a selection range.
type AddonGroup struct {
	Name     string
	Min, Max int
	Options  []Opt
}

// Opt is one variant or add-on. Off marks it unavailable.
type Opt struct {
	Name  string
	Cents int64
	Off   bool
}

type itemOpt func(*Item)

func item(key, name string, cents int64, photo, desc, ingr string, opts ...itemOpt) Item {
	it := Item{Key: key, Name: name, Cents: cents, Photo: photo, Desc: desc, Ingr: ingr}
	for _, o := range opts {
		o(&it)
	}
	return it
}

func diet(tags ...string) itemOpt { return func(i *Item) { i.Diet = append(i.Diet, tags...) } }
func allergen(tags ...string) itemOpt {
	return func(i *Item) { i.Allergens = append(i.Allergens, tags...) }
}
func spice(n int) itemOpt            { return func(i *Item) { i.Spice = n } }
func addons(g ...AddonGroup) itemOpt { return func(i *Item) { i.Addons = append(i.Addons, g...) } }
func outOfStock(hours int) itemOpt {
	return func(i *Item) { i.OutOfStock = true; i.OutOfStockHours = hours }
}
func existing(id, versionID string) itemOpt {
	return func(i *Item) { i.ID = id; i.VersionID = versionID }
}
func sizes(name string, opts ...Opt) itemOpt {
	return func(i *Item) { i.Variants = &VariantGroup{Name: name, Mode: "ABSOLUTE", Options: opts} }
}
func upsize(name string, opts ...Opt) itemOpt {
	return func(i *Item) { i.Variants = &VariantGroup{Name: name, Mode: "DELTA", Options: opts} }
}

func o(name string, cents int64) Opt          { return Opt{Name: name, Cents: cents} }
func off(name string, cents int64) Opt        { return Opt{Name: name, Cents: cents, Off: true} }
func cat(name string, items ...Item) Category { return Category{Name: name, Items: items} }

// Shared option groups.
var (
	spiceLevel = AddonGroup{Name: "Spice level", Min: 1, Max: 1, Options: []Opt{
		o("Mild", 0), o("Medium", 0), o("Hot", 0), o("Extra hot", 0)}}
	breadSide = AddonGroup{Name: "Add bread", Min: 0, Max: 3, Options: []Opt{
		o("Plain naan", 249), o("Garlic naan", 349), o("Butter naan", 299), o("Tandoori roti", 199)}}
	desiSides = AddonGroup{Name: "Sides", Min: 0, Max: 3, Options: []Opt{
		o("Raita", 249), o("Kachumber salad", 299), o("Mint chutney", 99), off("Mango pickle", 99)}}
	desiDrinks = AddonGroup{Name: "Add a drink", Min: 0, Max: 2, Options: []Opt{
		o("Mango lassi", 549), o("Sweet lassi", 499), o("Soft drink (can)", 249), o("Bottled water", 199)}}
	levantSauces = AddonGroup{Name: "Sauces", Min: 0, Max: 3, Options: []Opt{
		o("Garlic toum", 0), o("Tahini", 0), o("Hot sauce", 0), o("Pickled turnips", 0)}}
	levantExtras = AddonGroup{Name: "Extras", Min: 0, Max: 3, Options: []Opt{
		o("Extra meat", 449), o("Fries inside", 149), o("Feta", 199), o("Side of hummus", 349)}}
	coldDrinks = AddonGroup{Name: "Add a drink", Min: 0, Max: 2, Options: []Opt{
		o("Mint lemonade", 499), o("Ayran", 349), o("Soft drink (can)", 249), o("Sparkling water", 299)}}
	burgerSide = AddonGroup{Name: "Choose a side", Min: 1, Max: 1, Options: []Opt{
		o("Fries", 0), o("Side salad", 0), o("Onion rings", 150), o("Poutine", 399)}}
	burgerExtras = AddonGroup{Name: "Extras", Min: 0, Max: 4, Options: []Opt{
		o("Extra patty", 349), o("Beef bacon", 249), o("Jalapeños", 99), o("Fried egg", 149)}}
	wingSauce = AddonGroup{Name: "Choose your sauces", Min: 1, Max: 2, Options: []Opt{
		o("Honey garlic", 0), o("Buffalo", 0), o("Lemon pepper (dry)", 0), o("Sweet chili", 0), off("Nashville hot", 0)}}
	dips = AddonGroup{Name: "Dips", Min: 0, Max: 3, Options: []Opt{
		o("Garlic mayo", 99), o("Ranch", 99), o("Honey mustard", 99), o("Hot honey", 129)}}
	dessertTop = AddonGroup{Name: "Toppings", Min: 0, Max: 3, Options: []Opt{
		o("Crushed pistachio", 199), o("Scoop of vanilla ice cream", 299), o("Qashta cream", 249), o("Rose syrup", 99)}}
	riceSide = AddonGroup{Name: "Add a side", Min: 0, Max: 2, Options: []Opt{
		o("Extra rice", 349), o("Shirazi salad", 499), o("Grilled tomato", 199), o("Mast-o-khiar", 449)}}
)

// catalogueNS seeds the derived ids. Changing it changes every derived id.
var catalogueNS = uuid.MustParse("6f3a1c2e-0d5b-4c7a-9e21-5d0e7f8a9b10")

func catalogueID(parts ...string) string {
	name := "devworld"
	for _, p := range parts {
		name += "/" + p
	}
	return uuid.NewSHA1(catalogueNS, []byte(name)).String()
}

// Catalogue is every restaurant the reset makes visible to customers.
var Catalogue = []CatalogueRestaurant{
	{
		Slug: "bismillah-grill", ID: BismillahRestaurantID, OwnerID: "a0000000-0000-4000-8000-000000000208", Persona: true,
		Name:        "Bismillah Grill",
		Description: "Lahori karahi, charcoal kebabs and biryani on the Danforth since 2009. Everything cooked to order in the karahi it is served in.",
		Cuisines:    []string{"pakistani", "indian"}, Tags: "karahi kebab biryani naan bbq",
		Line1: "1240 Danforth Avenue", PostalCode: "M4J 1M6", Lat: 43.6815, Lng: -79.3310,
		PriceBand: "$$", Rating: 4.7, RatingCount: 318, PrepMinutes: 25, MinOrder: 1500, Hours: hoursAllDay,
		Hero: "karahi", Palette: 0,
		Categories: []Category{
			cat("Starters",
				item("samosa", "Vegetable Samosa (2 pc)", 599, "samosa", "Crisp pastry filled with spiced potato and peas, with tamarind chutney.", "wheat flour, potato, peas, cumin, coriander", diet("VEGETARIAN", "VEGAN"), allergen("WHEAT_TRITICALE")),
				item("pakora", "Chicken Pakora", 999, "pakora", "Boneless chicken in a chickpea batter, fried crisp. Served with mint chutney.", "chicken, gram flour, ajwain, chili", spice(2)),
				item("chapli", "Peshawari Chapli Kebab (2 pc)", 1299, "chapli-kebab", "Flat minced-beef kebabs with pomegranate seed and green chili, shallow fried.", "beef, onion, tomato, pomegranate seed, coriander", spice(3), addons(desiSides)),
			),
			Category{ID: "e0000000-0000-4000-8000-000000000208", Name: "Mains", Items: []Item{
				item("chicken-karahi", "Chicken Karahi", 1899, "karahi", "Tomato and ginger karahi.", "chicken, tomato, ginger, garlic", existing("f0000000-0000-4000-8000-000000000281", "f0000000-0000-4000-8000-000000000381")),
				item("lamb-karahi", "Lamb Karahi", 2499, "karahi", "Bone-in lamb cooked down with tomato, green chili and black pepper. Finished with julienned ginger.", "lamb, tomato, ginger, green chili, black pepper",
					spice(3), sizes("Portion", o("Half (serves 1–2)", 2499), o("Full (serves 3–4)", 4499)), addons(spiceLevel, breadSide)),
				item("nihari", "Beef Nihari", 1999, "nihari", "Slow-cooked overnight beef shank in a rich, spiced gravy with fresh ginger and lemon.", "beef shank, wheat flour, ghee, ginger, garam masala", spice(3), allergen("WHEAT_TRITICALE", "MILK"), addons(breadSide)),
				item("haleem", "Haleem", 1699, "haleem", "Wheat, lentils and shredded beef stirred for hours until silky. Topped with fried onion.", "beef, wheat, lentils, barley, fried onion", spice(2), allergen("WHEAT_TRITICALE"), outOfStock(0)),
				item("butter-chicken", "Butter Chicken", 1799, "butter-chicken", "Tandoor-roasted chicken in a mild tomato, butter and cream sauce.", "chicken, tomato, butter, cream, fenugreek", spice(1), allergen("MILK"), addons(breadSide, desiSides)),
				item("daal", "Daal Tadka", 1299, "daal", "Yellow lentils tempered with cumin, garlic and dried red chili.", "toor dal, garlic, cumin, ghee", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK"), spice(2), addons(breadSide)),
			}},
			cat("BBQ",
				item("seekh", "Beef Seekh Kebab (4 pc)", 1499, "seekh-kebab", "Charcoal-grilled minced beef skewers with onion and coriander.", "beef, onion, coriander, chili", spice(2), addons(desiSides)),
				item("tikka", "Chicken Tikka (leg quarter)", 1199, "chicken-tikka", "Yogurt and spice marinated chicken leg, grilled over charcoal.", "chicken, yogurt, chili, lemon", spice(2), allergen("MILK"), addons(desiSides)),
				item("tandoori", "Tandoori Chicken", 1599, "tandoori-chicken", "Bone-in chicken, marinated overnight and roasted in the tandoor.", "chicken, yogurt, Kashmiri chili, garlic",
					spice(2), allergen("MILK"), sizes("Size", o("Half", 1599), o("Whole", 2899))),
			),
			cat("Biryani & Rice",
				item("chicken-biryani", "Chicken Biryani", 1699, "biryani", "Basmati layered with spiced chicken, saffron and fried onion, sealed and steamed.", "basmati rice, chicken, yogurt, saffron, fried onion",
					spice(2), allergen("MILK"), sizes("Size", o("Regular", 1699), o("Family (serves 3)", 3999)), addons(desiSides, desiDrinks)),
				item("veg-biryani", "Vegetable Biryani", 1499, "biryani", "Seasonal vegetables and basmati with whole spices and mint.", "basmati rice, carrot, peas, potato, mint", diet("VEGETARIAN"), addons(desiSides)),
			),
			cat("Breads",
				item("garlic-naan", "Garlic Naan", 399, "naan", "Tandoor naan.", "wheat, garlic, yoghurt", existing("f0000000-0000-4000-8000-000000000282", "f0000000-0000-4000-8000-000000000382")),
				item("plain-naan", "Plain Naan", 249, "naan", "Hand-stretched and baked on the tandoor wall.", "wheat flour, yogurt, butter", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("paratha", "Lachha Paratha", 349, "paratha", "Flaky layered flatbread, griddled with ghee.", "wheat flour, ghee", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
			),
			cat("Drinks & Dessert",
				item("lassi", "Mango Lassi", 549, "mango-lassi", "Alphonso mango blended with yogurt.", "mango, yogurt, sugar", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("chai", "Karak Chai", 299, "masala-chai", "Strong black tea boiled with milk, cardamom and ginger.", "black tea, milk, cardamom, ginger", diet("VEGETARIAN"), allergen("MILK")),
				item("kheer", "Kheer", 599, "kheer", "Slow-cooked rice pudding with cardamom and pistachio.", "rice, milk, sugar, cardamom, pistachio", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS")),
			),
		},
	},
	{
		Slug: "expiring-halal", ID: "b0000000-0000-4000-8000-000000000209", OwnerID: "a0000000-0000-4000-8000-000000000209", Persona: true,
		Name:        "Bamyan Kebab House",
		Description: "Afghan home cooking in Thorncliffe Park: Kabuli pulao, mantu and charcoal kebabs, with bolani made fresh every morning.",
		Cuisines:    []string{"afghan"}, Tags: "kabuli pulao mantu kebab bolani",
		Line1: "18 Thorncliffe Park Drive", PostalCode: "M4H 1N7", Lat: 43.7046, Lng: -79.3466,
		PriceBand: "$$", Rating: 4.5, RatingCount: 212, PrepMinutes: 25, MinOrder: 1500, Hours: hoursAllDay,
		Hero: "kabuli-pulao", Palette: 1,
		Categories: []Category{
			cat("Appetizers",
				item("bolani", "Bolani", 799, "bolani", "Thin stuffed flatbread with potato and leek, served with yogurt dip.", "wheat flour, potato, leek, yogurt", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK"),
					sizes("Filling", o("Potato", 799), o("Leek (gandana)", 799), o("Pumpkin", 849))),
				item("aushak-soup", "Lentil Soup", 599, "lentil-soup", "Red lentil soup with dried mint.", "red lentils, onion, dried mint", diet("VEGAN", "GLUTEN_FREE")),
				item("sambosa", "Beef Sambosa (3 pc)", 699, "samosa", "Pastry triangles filled with minced beef and chickpeas.", "wheat flour, beef, chickpeas, onion", allergen("WHEAT_TRITICALE")),
			),
			Category{ID: "e0000000-0000-4000-8000-000000000209", Name: "Mains", Items: []Item{
				item("seekh", "Seekh Kebab", 1699, "seekh-kebab", "Minced kebab.", "beef, onion, spice", existing("f0000000-0000-4000-8000-000000000291", "f0000000-0000-4000-8000-000000000391")),
				item("kabuli-pulao", "Kabuli Pulao", 2199, "kabuli-pulao", "Lamb shank under rice with caramelised carrots, raisins and almonds.", "lamb, basmati rice, carrot, raisins, almonds", allergen("TREE_NUTS"),
					addons(AddonGroup{Name: "Sides", Min: 0, Max: 2, Options: []Opt{o("Afghan salad", 399), o("Chutney sabz", 149), o("Naan-e Afghani", 299)}})),
				item("mantu", "Mantu", 1599, "mantu", "Steamed beef dumplings under yogurt, split-pea sauce and dried mint.", "wheat flour, beef, onion, yogurt, split peas", allergen("WHEAT_TRITICALE", "MILK"),
					sizes("Portion", o("8 pieces", 1599), o("12 pieces", 2199))),
				item("chopan", "Lamb Chopan Kebab", 2399, "lamb-kebab", "Lamb chops on the skewer, salted and grilled over charcoal.", "lamb, salt, black pepper", diet("GLUTEN_FREE"), addons(spiceLevel)),
				item("chicken-tikka", "Chicken Tikka Kebab", 1799, "chicken-tikka", "Chicken breast marinated in yogurt and garlic.", "chicken, yogurt, garlic", allergen("MILK")),
				item("qorma", "Qorma-e Sabzi", 1499, "ghormeh-sabzi", "Spinach and herb stew with beef.", "spinach, beef, onion, coriander", diet("GLUTEN_FREE")),
			}},
			cat("Bread & Rice",
				item("naan", "Naan-e Afghani", 299, "naan", "Long oval bread with nigella and sesame.", "wheat flour, nigella, sesame", diet("VEGAN"), allergen("WHEAT_TRITICALE", "SESAME")),
				item("challow", "Challow Rice", 499, "saffron-rice", "Long-grain white rice with cumin.", "basmati rice, cumin", diet("VEGAN", "GLUTEN_FREE")),
			),
			cat("Dessert & Tea",
				item("firni", "Firni", 599, "firni", "Milk pudding with rosewater, cardamom and pistachio.", "milk, cornstarch, rosewater, pistachio", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS")),
				item("green-tea", "Cardamom Green Tea (pot)", 449, "turkish-tea", "A pot of green tea brewed with cardamom.", "green tea, cardamom", diet("VEGAN")),
				item("baklava", "Baklava (4 pc)", 699, "baklava", "Walnut baklava with syrup.", "filo, walnut, butter, syrup", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "TREE_NUTS", "MILK")),
			),
		},
	},
	{
		Slug: "paused", ID: "b0000000-0000-4000-8000-000000000211", OwnerID: "a0000000-0000-4000-8000-000000000211", Persona: true,
		Name:        "Galata Pide & Grill",
		Description: "Stone-oven pide, lahmacun and Adana kebab in Leslieville. Taking a short break from new orders.",
		Cuisines:    []string{"turkish", "mediterranean"}, Tags: "pide lahmacun adana doner kunefe",
		Line1: "1020 Queen Street East", PostalCode: "M4M 1K1", Lat: 43.6614, Lng: -79.3365,
		PriceBand: "$$", Rating: 4.6, RatingCount: 154, PrepMinutes: 20, MinOrder: 1500, Hours: hoursAllDay,
		Hero: "pide", Palette: 2,
		Categories: []Category{
			cat("Pide & Lahmacun",
				item("kiymali-pide", "Kıymalı Pide", 1699, "pide", "Boat-shaped flatbread with minced beef, tomato and peppers.", "wheat flour, beef, tomato, pepper", allergen("WHEAT_TRITICALE"),
					addons(AddonGroup{Name: "Add a topping", Min: 0, Max: 2, Options: []Opt{o("Egg", 149), o("Kaşar cheese", 249), o("Sucuk", 349)}})),
				item("peynirli-pide", "Peynirli Pide", 1499, "pide", "White cheese and kaşar with butter.", "wheat flour, feta, kaşar, butter", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("lahmacun", "Lahmacun", 699, "lahmacun", "Thin crisp flatbread with spiced lamb, with parsley and lemon to roll.", "wheat flour, lamb, tomato, parsley", allergen("WHEAT_TRITICALE"), spice(1),
					sizes("Quantity", o("1 piece", 699), o("3 pieces", 1799))),
				item("gozleme", "Spinach Gözleme", 1199, "gozleme", "Hand-rolled flatbread with spinach and white cheese.", "wheat flour, spinach, feta", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
			),
			cat("Grill",
				item("adana", "Adana Kebab", 2199, "adana-kebab", "Hand-minced lamb with red pepper, grilled on a wide skewer. Rice, salad and lavash.", "lamb, red pepper flakes, onion", spice(3), allergen("WHEAT_TRITICALE")),
				item("iskender", "İskender", 2399, "iskender", "Döner over pide cubes, tomato sauce, browned butter and yogurt.", "beef, wheat flour, tomato, butter, yogurt", allergen("WHEAT_TRITICALE", "MILK")),
				item("doner-plate", "Chicken Döner Plate", 1899, "doner", "Shaved chicken döner with rice, salad and garlic sauce.", "chicken, rice, lettuce, garlic", addons(levantSauces)),
				item("kofte", "Izgara Köfte", 1899, "lamb-kebab", "Grilled beef köfte with piyaz salad.", "beef, onion, breadcrumbs, beans", allergen("WHEAT_TRITICALE")),
			),
			cat("Soups & Sides",
				item("mercimek", "Mercimek Çorbası", 599, "lentil-soup", "Red lentil soup with lemon and paprika butter.", "red lentils, onion, butter, paprika", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("ezme", "Ezme & Bread", 699, "mezze", "Spicy tomato and pepper dip with warm bread.", "tomato, pepper, pomegranate molasses, wheat", diet("VEGAN"), allergen("WHEAT_TRITICALE"), spice(2)),
			),
			cat("Dessert & Drinks",
				item("kunefe", "Künefe", 999, "kunefe", "Shredded pastry over melted cheese, soaked in syrup. Baked to order.", "kadayıf, cheese, butter, syrup, pistachio", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK", "TREE_NUTS")),
				item("baklava", "Pistachio Baklava (4 pc)", 899, "baklava", "Gaziantep-style pistachio baklava.", "filo, pistachio, butter, syrup", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "TREE_NUTS", "MILK")),
				item("ayran", "Ayran", 349, "ayran", "Salted yogurt drink.", "yogurt, water, salt", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("cay", "Turkish Tea", 249, "turkish-tea", "Black tea in a tulip glass.", "black tea", diet("VEGAN")),
			),
		},
	},
	{
		Slug: "saffron-lane-biryani", ID: "b0000000-0000-4000-8000-000000000301", OwnerID: "a0000000-0000-4000-8000-000000000301",
		Name:        "Saffron Lane Biryani",
		Description: "Hyderabadi dum biryani on Gerrard Street: raw meat and rice sealed in the pot and cooked together.",
		Cuisines:    []string{"indian"}, Tags: "biryani hyderabadi tikka paneer",
		Line1: "1430 Gerrard Street East", PostalCode: "M4L 1Z6", Lat: 43.6725, Lng: -79.3205,
		PriceBand: "$$", Rating: 4.6, RatingCount: 441, PrepMinutes: 25, MinOrder: 1500, Hours: hoursAllDay,
		CertDays: 300, Body: 0, Hero: "biryani", Palette: 3,
		Categories: []Category{
			cat("Biryani",
				item("chicken-dum", "Chicken Dum Biryani", 1699, "biryani", "Marinated chicken and aged basmati cooked together under a sealed lid. With mirchi ka salan and raita.", "chicken, basmati rice, yogurt, saffron, mint",
					spice(3), allergen("MILK"), sizes("Size", o("Single", 1699), o("Double", 2999), o("Family pack (serves 4)", 4999)), addons(spiceLevel, desiDrinks)),
				item("goat-dum", "Goat Dum Biryani", 1999, "biryani", "Bone-in goat, slow cooked with rice, saffron and fried onion.", "goat, basmati rice, yogurt, saffron",
					spice(3), allergen("MILK"), sizes("Size", o("Single", 1999), o("Double", 3599)), addons(spiceLevel)),
				item("egg-biryani", "Egg Biryani", 1399, "biryani", "Boiled eggs in masala, layered with rice.", "eggs, basmati rice, onion, garam masala", diet("VEGETARIAN"), allergen("EGGS"), spice(2)),
				item("paneer-biryani", "Paneer Biryani", 1499, "biryani", "Paneer and vegetables with saffron rice.", "paneer, basmati rice, peas, saffron", diet("VEGETARIAN"), allergen("MILK"), spice(2)),
			),
			cat("Starters",
				item("chicken-65", "Chicken 65", 1199, "popcorn-chicken", "Fried chicken bites tossed with curry leaf and red chili.", "chicken, curry leaves, chili, rice flour", spice(4)),
				item("paneer-tikka", "Paneer Tikka", 1299, "paneer-tikka", "Charred cubes of paneer, pepper and onion.", "paneer, yogurt, capsicum, onion", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("veg-samosa", "Samosa Chaat", 899, "chotpoti", "Crushed samosa with chickpeas, yogurt and chutneys.", "wheat flour, potato, chickpeas, yogurt, tamarind", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
			),
			cat("Curries",
				item("butter-chicken", "Butter Chicken", 1699, "butter-chicken", "Tandoori chicken in makhani gravy.", "chicken, tomato, butter, cream", allergen("MILK"), addons(breadSide)),
				item("palak-paneer", "Palak Paneer", 1499, "palak-paneer", "Paneer in a spinach and garlic purée.", "spinach, paneer, garlic, cream", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK"), addons(breadSide)),
				item("chana", "Chana Masala", 1299, "chana-masala", "Chickpeas simmered with onion, tomato and amchur.", "chickpeas, onion, tomato, amchur", diet("VEGAN", "GLUTEN_FREE"), spice(2), addons(breadSide)),
				item("dal-makhani", "Dal Makhani", 1299, "daal", "Black lentils simmered overnight with butter.", "black lentils, kidney beans, butter, cream", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
			),
			cat("Breads",
				item("butter-naan", "Butter Naan", 299, "naan", "Brushed with butter straight from the tandoor.", "wheat flour, butter, yogurt", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("garlic-naan", "Garlic Naan", 349, "naan", "With chopped garlic and coriander.", "wheat flour, garlic, coriander", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
			),
			cat("Desserts & Drinks",
				item("double-ka-meetha", "Gulab Jamun (3 pc)", 599, "gulab-jamun", "Warm milk dumplings in cardamom syrup.", "milk solids, sugar, cardamom", diet("VEGETARIAN"), allergen("MILK", "WHEAT_TRITICALE")),
				item("rasmalai", "Rasmalai (2 pc)", 699, "rasmalai", "Soft cheese patties in saffron milk.", "milk, sugar, saffron, pistachio", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS")),
				item("lassi", "Mango Lassi", 549, "mango-lassi", "Mango and yogurt.", "mango, yogurt", diet("VEGETARIAN"), allergen("MILK")),
				item("irani-chai", "Irani Chai", 299, "masala-chai", "Hyderabad-style milky tea.", "tea, milk, sugar", diet("VEGETARIAN"), allergen("MILK")),
			),
		},
	},
	{
		Slug: "cedar-and-sumac", ID: "b0000000-0000-4000-8000-000000000302", OwnerID: "a0000000-0000-4000-8000-000000000302",
		Name:        "Cedar & Sumac",
		Description: "Lebanese grill and bakery on the Danforth. Manakish from the oven, shish tawook from the charcoal grill, mezze made daily.",
		Cuisines:    []string{"lebanese", "middle-eastern"}, Tags: "shawarma tawook manakish falafel mezze",
		Line1: "590 Danforth Avenue", PostalCode: "M4K 1R1", Lat: 43.6781, Lng: -79.3487,
		PriceBand: "$$", Rating: 4.8, RatingCount: 527, PrepMinutes: 20, MinOrder: 1200, Hours: hoursAllDay,
		CertDays: 260, Body: 1, Hero: "mezze", Palette: 4,
		Categories: []Category{
			cat("Mezze",
				item("hummus", "Hummus", 799, "hummus", "Chickpeas, tahini and lemon with olive oil. With pita.", "chickpeas, tahini, lemon, garlic, olive oil", diet("VEGAN"), allergen("SESAME", "WHEAT_TRITICALE"),
					addons(AddonGroup{Name: "Top it", Min: 0, Max: 1, Options: []Opt{o("Shawarma beef", 499), o("Pine nuts", 249)}})),
				item("baba-ghanoush", "Baba Ghanoush", 849, "baba-ghanoush", "Smoked eggplant with tahini and pomegranate.", "eggplant, tahini, garlic, pomegranate", diet("VEGAN"), allergen("SESAME")),
				item("tabbouleh", "Tabbouleh", 899, "tabbouleh", "Parsley, mint, tomato and fine bulgur with lemon.", "parsley, bulgur, tomato, mint, lemon", diet("VEGAN"), allergen("WHEAT_TRITICALE")),
				item("fattoush", "Fattoush", 999, "fattoush", "Crisp greens, toasted pita and sumac dressing.", "romaine, cucumber, radish, pita, sumac", diet("VEGAN"), allergen("WHEAT_TRITICALE"),
					upsize("Size", o("Regular", 0), o("Large", 400))),
				item("kibbeh", "Kibbeh (4 pc)", 999, "kibbeh", "Bulgur shells stuffed with spiced beef and pine nuts.", "bulgur, beef, onion, pine nuts", allergen("WHEAT_TRITICALE", "TREE_NUTS")),
				item("falafel", "Falafel (6 pc)", 799, "falafel", "Fava and chickpea fritters with tahini.", "chickpeas, fava beans, parsley, cumin", diet("VEGAN"), allergen("SESAME")),
			),
			cat("Manakish",
				item("zaatar", "Za'atar Manakish", 599, "manakish", "Za'atar and olive oil on fresh dough.", "wheat flour, za'atar, sesame, olive oil", diet("VEGAN"), allergen("WHEAT_TRITICALE", "SESAME"),
					addons(AddonGroup{Name: "Add", Min: 0, Max: 3, Options: []Opt{o("Tomato", 99), o("Cucumber", 99), o("Olives", 99), o("Akkawi cheese", 249)}})),
				item("cheese-manakish", "Cheese Manakish", 799, "manakish", "Akkawi and mozzarella.", "wheat flour, akkawi, mozzarella", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("lahm-bi-ajeen", "Lahm bi Ajeen", 899, "lahmacun", "Spiced minced beef, tomato and onion.", "wheat flour, beef, tomato, onion", allergen("WHEAT_TRITICALE")),
			),
			cat("Grill",
				item("tawook-plate", "Shish Tawook Plate", 1999, "shish-tawook", "Garlic and lemon chicken skewers with rice, salad, toum and pita.", "chicken, garlic, lemon, yogurt", allergen("MILK", "WHEAT_TRITICALE"), addons(levantSauces, coldDrinks)),
				item("kafta-plate", "Kafta Plate", 1999, "lamb-kebab", "Beef and parsley kafta skewers with rice and salad.", "beef, parsley, onion, seven spice", allergen("WHEAT_TRITICALE"), addons(levantSauces)),
				item("mixed-grill", "Mixed Grill for Two", 4499, "lamb-kebab", "Tawook, kafta and lamb skewers with rice, fattoush, hummus and pita.", "chicken, beef, lamb, rice", allergen("WHEAT_TRITICALE", "SESAME"), outOfStock(6)),
				item("shawarma-wrap", "Chicken Shawarma Wrap", 1199, "shawarma-wrap", "Shaved chicken, garlic toum, pickles and fries rolled in saj bread.", "chicken, pita, garlic, pickles, potato", allergen("WHEAT_TRITICALE"), addons(levantSauces, levantExtras)),
			),
			cat("Sweets & Drinks",
				item("baklava", "Assorted Baklava (6 pc)", 999, "baklava", "Pistachio, cashew and walnut.", "filo, nuts, butter, syrup", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "TREE_NUTS", "MILK")),
				item("mint-lemonade", "Mint Lemonade", 499, "mint-lemonade", "Fresh lemon blended with mint.", "lemon, mint, sugar", diet("VEGAN", "GLUTEN_FREE")),
				item("jallab", "Jallab", 549, "mint-lemonade", "Date and grape molasses with rose water and pine nuts.", "date molasses, rose water, pine nuts", diet("VEGAN"), allergen("TREE_NUTS")),
			),
		},
	},
	{
		Slug: "xamar-kitchen", ID: "b0000000-0000-4000-8000-000000000303", OwnerID: "a0000000-0000-4000-8000-000000000303",
		Name:        "Xamar Kitchen",
		Description: "Somali rice plates, suqaar and sambusa in Regent Park. Every plate comes with a banana, the way it should.",
		Cuisines:    []string{"somali"}, Tags: "bariis suqaar sambusa goat laxoox",
		Line1: "615 Dundas Street East", PostalCode: "M5A 2B9", Lat: 43.6603, Lng: -79.3618,
		PriceBand: "$", Rating: 4.7, RatingCount: 189, PrepMinutes: 20, MinOrder: 1200, Hours: hoursAllDay,
		CertDays: 340, Body: 2, Hero: "somali-rice", Palette: 5,
		Categories: []Category{
			cat("Rice Plates",
				item("goat-bariis", "Goat with Bariis", 1899, "somali-rice", "Tender goat on spiced basmati with raisins, salad, banana and green hot sauce.", "goat, basmati rice, cumin, cardamom, raisins",
					sizes("Portion", o("Regular", 1899), o("Large", 2399)), addons(AddonGroup{Name: "Extras", Min: 0, Max: 3, Options: []Opt{o("Extra banana", 99), o("Basbaas (green sauce)", 99), o("Extra goat", 699)}})),
				item("chicken-bariis", "Chicken with Bariis", 1599, "somali-rice", "Roast chicken leg on spiced rice.", "chicken, basmati rice, xawaash spice", sizes("Portion", o("Regular", 1599), o("Large", 1999))),
				item("fish-bariis", "Fried Fish with Bariis", 1799, "grilled-fish", "Kingfish steak, fried and served with rice and lemon.", "kingfish, rice, lemon", allergen("FISH")),
			),
			cat("Pasta & Suqaar",
				item("beef-suqaar", "Beef Suqaar", 1599, "suqaar", "Small cubes of beef stir-fried with peppers and onion.", "beef, bell pepper, onion, xawaash", addons(spiceLevel)),
				item("chicken-suqaar", "Chicken Suqaar", 1499, "suqaar", "Chicken pieces with peppers, onion and coriander.", "chicken, bell pepper, onion, coriander", addons(spiceLevel)),
				item("baasto", "Baasto with Beef Sauce", 1399, "mac-and-cheese", "Spaghetti with slow-cooked beef and tomato sauce, Somali style.", "spaghetti, beef, tomato, xawaash", allergen("WHEAT_TRITICALE")),
			),
			cat("Breakfast & Breads",
				item("laxoox", "Laxoox with Honey & Ghee", 899, "laxoox", "Spongy fermented flatbread with honey and ghee.", "sorghum flour, wheat flour, honey, ghee", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("beer", "Beer iyo Laxoox", 1299, "laxoox", "Pan-fried liver with onions, served with laxoox.", "beef liver, onion, pepper, flatbread", allergen("WHEAT_TRITICALE")),
				item("chapati", "Chapati (2 pc)", 349, "paratha", "Soft flatbread.", "wheat flour, oil", diet("VEGAN"), allergen("WHEAT_TRITICALE")),
			),
			cat("Snacks",
				item("sambusa", "Beef Sambusa (3 pc)", 699, "sambusa", "Crisp triangles of spiced minced beef.", "wheat flour, beef, onion, green chili", allergen("WHEAT_TRITICALE"), spice(2)),
				item("veg-sambusa", "Lentil Sambusa (3 pc)", 599, "sambusa", "Spiced lentil filling.", "wheat flour, lentils, onion", diet("VEGAN"), allergen("WHEAT_TRITICALE")),
				item("bajiye", "Bajiye", 599, "pakora", "Black-eyed pea fritters.", "black-eyed peas, onion, chili", diet("VEGAN", "GLUTEN_FREE")),
			),
			cat("Drinks",
				item("shaah", "Shaah (spiced tea)", 249, "somali-tea", "Black tea with cardamom, cinnamon and milk.", "black tea, cardamom, cinnamon, milk", diet("VEGETARIAN"), allergen("MILK")),
				item("mango-juice", "Fresh Mango Juice", 499, "mango-lassi", "Blended mango.", "mango", diet("VEGAN", "GLUTEN_FREE")),
				item("cambe", "Banana & Date Smoothie", 599, "milkshake", "Banana, dates and milk.", "banana, dates, milk", diet("VEGETARIAN"), allergen("MILK")),
			),
		},
	},
	{
		Slug: "selera-kopitiam", ID: "b0000000-0000-4000-8000-000000000304", OwnerID: "a0000000-0000-4000-8000-000000000304",
		Name:        "Selera Kopitiam",
		Description: "A Malaysian coffee shop on Spadina: nasi lemak, curry laksa, satay off the grill and teh tarik pulled to order.",
		Cuisines:    []string{"malaysian", "indonesian"}, Tags: "nasi lemak laksa satay roti canai rendang",
		Line1: "228 Spadina Avenue", PostalCode: "M5T 2C2", Lat: 43.6517, Lng: -79.3978,
		PriceBand: "$$", Rating: 4.6, RatingCount: 276, PrepMinutes: 20, MinOrder: 1500, Hours: hoursAllDay,
		CertDays: 290, Body: 0, Hero: "nasi-lemak", Palette: 6,
		Categories: []Category{
			cat("Rice",
				item("nasi-lemak", "Nasi Lemak", 1599, "nasi-lemak", "Coconut rice, sambal, egg, peanuts, anchovies and cucumber.", "coconut rice, sambal, egg, peanuts, anchovies", spice(3), allergen("PEANUTS", "EGGS", "FISH"),
					sizes("With", o("Ayam goreng (fried chicken)", 1599), o("Beef rendang", 1799), o("Plain", 1099))),
				item("nasi-goreng", "Nasi Goreng Kampung", 1499, "nasi-goreng", "Village-style fried rice with chili, anchovies and a fried egg.", "rice, chili, anchovies, egg", spice(3), allergen("FISH", "EGGS")),
				item("rendang", "Beef Rendang with Rice", 1899, "rendang", "Beef slow-cooked in coconut and spice until dry and dark.", "beef, coconut, lemongrass, galangal, chili", diet("GLUTEN_FREE"), spice(2)),
			),
			cat("Noodles",
				item("laksa", "Curry Laksa", 1699, "laksa", "Coconut curry broth with noodles, chicken, tofu puffs and egg.", "egg noodles, coconut milk, chicken, tofu, egg", spice(3), allergen("WHEAT_TRITICALE", "EGGS", "SOY"),
					addons(AddonGroup{Name: "Add", Min: 0, Max: 3, Options: []Opt{o("Prawns", 499), o("Extra tofu puffs", 199), o("Extra noodles", 249)}})),
				item("mee-goreng", "Mee Goreng Mamak", 1499, "mee-goreng", "Wok-fried yellow noodles with potato, tofu and egg.", "egg noodles, potato, tofu, egg, soy", spice(2), allergen("WHEAT_TRITICALE", "EGGS", "SOY")),
				item("char-kway-teow", "Char Kway Teow", 1599, "char-kway-teow", "Flat rice noodles with prawns, bean sprouts and chives, smoky from the wok.", "rice noodles, prawns, egg, bean sprouts", allergen("CRUSTACEANS_MOLLUSCS", "EGGS", "SOY")),
			),
			cat("Grill & Bread",
				item("satay", "Chicken Satay", 1199, "satay", "Turmeric chicken skewers with peanut sauce, cucumber and onion.", "chicken, turmeric, lemongrass, peanuts", allergen("PEANUTS"),
					sizes("Skewers", o("6 skewers", 1199), o("10 skewers", 1799))),
				item("roti-canai", "Roti Canai with Dhal", 799, "roti-canai", "Flaky griddled flatbread with dhal curry.", "wheat flour, ghee, lentils", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("murtabak", "Chicken Murtabak", 1299, "roti-canai", "Stuffed roti with minced chicken, egg and onion.", "wheat flour, chicken, egg, onion", allergen("WHEAT_TRITICALE", "EGGS"), outOfStock(0)),
			),
			cat("Dessert & Drinks",
				item("cendol", "Cendol", 699, "", "Shaved ice, pandan jelly, coconut milk and palm sugar.", "pandan, coconut milk, gula melaka, red beans", diet("VEGAN", "GLUTEN_FREE")),
				item("teh-tarik", "Teh Tarik", 399, "teh-tarik", "Pulled milk tea.", "black tea, condensed milk", diet("VEGETARIAN"), allergen("MILK"),
					sizes("Temperature", o("Hot", 399), o("Iced", 449))),
				item("kopi", "Kopi O", 349, "turkish-tea", "Strong black coffee with sugar.", "coffee, sugar", diet("VEGAN")),
			),
		},
	},
	{
		Slug: "crispy-crescent-chicken", ID: "b0000000-0000-4000-8000-000000000305", OwnerID: "a0000000-0000-4000-8000-000000000305",
		Name:        "Crispy Crescent Chicken",
		Description: "Buttermilk fried chicken, wings and sandwiches near Yonge-Dundas. Hand-breaded, never frozen.",
		Cuisines:    []string{"fried-chicken"}, Tags: "fried chicken wings tenders sandwich",
		Line1: "345 Yonge Street", PostalCode: "M5B 1S1", Lat: 43.6578, Lng: -79.3812,
		PriceBand: "$", Rating: 4.4, RatingCount: 603, PrepMinutes: 15, MinOrder: 1000, Hours: hoursAllDay,
		CertDays: 320, Body: 1, Hero: "fried-chicken", Palette: 7,
		Categories: []Category{
			cat("Chicken",
				item("bucket", "Fried Chicken Bucket", 1999, "fried-chicken", "Bone-in buttermilk fried chicken, mixed pieces.", "chicken, buttermilk, wheat flour, paprika", allergen("MILK", "WHEAT_TRITICALE"),
					sizes("Pieces", o("8 pieces", 1999), o("12 pieces", 2799), o("16 pieces", 3499)), addons(dips)),
				item("tenders", "Chicken Tenders", 1099, "chicken-tenders", "Breast tenders, hand-breaded.", "chicken, buttermilk, wheat flour", allergen("MILK", "WHEAT_TRITICALE"),
					sizes("Pieces", o("3 pieces", 1099), o("5 pieces", 1599)), addons(dips)),
				item("wings", "Wings", 1399, "chicken-wings", "Crisp wings tossed in your choice of sauces.", "chicken wings, wheat flour",
					sizes("Size", o("1 lb", 1399), o("2 lb", 2499)), addons(wingSauce, dips)),
				item("popcorn", "Popcorn Chicken", 899, "popcorn-chicken", "Bite-size crispy chicken.", "chicken, wheat flour, spices", allergen("WHEAT_TRITICALE"), addons(dips)),
			),
			cat("Sandwiches",
				item("classic-sandwich", "Classic Chicken Sandwich", 1199, "chicken-sandwich", "Fried thigh, pickles and mayo on a brioche bun.", "chicken, brioche, pickles, mayo", allergen("WHEAT_TRITICALE", "EGGS", "MILK"),
					upsize("Make it a combo", o("Sandwich only", 0), o("Combo with fries and a drink", 450)), addons(burgerExtras)),
				item("spicy-sandwich", "Nashville Hot Sandwich", 1299, "chicken-sandwich", "Cayenne-oil glazed thigh with slaw and pickles.", "chicken, cayenne, cabbage, brioche", spice(4), allergen("WHEAT_TRITICALE", "EGGS", "MILK"),
					upsize("Make it a combo", o("Sandwich only", 0), o("Combo with fries and a drink", 450))),
				item("wrap", "Crispy Chicken Wrap", 999, "shawarma-wrap", "Tenders, lettuce, tomato and ranch in a flour tortilla.", "chicken, tortilla, lettuce, ranch", allergen("WHEAT_TRITICALE", "MILK", "EGGS")),
			),
			cat("Sides",
				item("fries", "Seasoned Fries", 449, "fries", "Skin-on fries with house seasoning.", "potato, paprika, salt", diet("VEGAN", "GLUTEN_FREE"), upsize("Size", o("Regular", 0), o("Large", 200))),
				item("mac", "Mac & Cheese", 599, "mac-and-cheese", "Baked with cheddar.", "macaroni, cheddar, milk", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("coleslaw", "Coleslaw", 349, "coleslaw", "Creamy cabbage slaw.", "cabbage, carrot, mayo", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("EGGS")),
				item("corn", "Corn on the Cob", 399, "corn-on-the-cob", "Buttered and salted.", "corn, butter", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("poutine", "Chicken Poutine", 999, "poutine", "Fries, cheese curds, gravy and popcorn chicken.", "potato, cheese curds, gravy, chicken", allergen("MILK", "WHEAT_TRITICALE")),
			),
			cat("Drinks",
				item("lemonade", "Fresh Lemonade", 399, "mint-lemonade", "Squeezed in-house.", "lemon, sugar", diet("VEGAN")),
				item("shake", "Milkshake", 599, "milkshake", "Thick shake.", "milk, ice cream", diet("VEGETARIAN"), allergen("MILK"),
					sizes("Flavour", o("Vanilla", 599), o("Chocolate", 599), o("Strawberry", 599), off("Salted caramel", 649))),
			),
		},
	},
	{
		Slug: "union-smash-burgers", ID: "b0000000-0000-4000-8000-000000000306", OwnerID: "a0000000-0000-4000-8000-000000000306",
		Name:        "Union Smash Burgers",
		Description: "Halal smash burgers on Church Street: two thin patties with crisp edges, potato buns, fries cut in the morning.",
		Cuisines:    []string{"burgers"}, Tags: "smash burger fries poutine milkshake",
		Line1: "512 Church Street", PostalCode: "M4Y 2C8", Lat: 43.6655, Lng: -79.3808,
		PriceBand: "$$", Rating: 4.5, RatingCount: 388, PrepMinutes: 15, MinOrder: 1200, Hours: hoursAllDay,
		CertDays: 210, Body: 2, Hero: "smash-burger", Palette: 8,
		Categories: []Category{
			cat("Burgers",
				item("classic-smash", "Classic Smash", 1299, "smash-burger", "Two smashed beef patties, American cheese, pickles, onion and house sauce.", "beef, cheese, potato bun, pickles", allergen("WHEAT_TRITICALE", "MILK", "EGGS", "SESAME"),
					sizes("Patties", o("Double", 1299), o("Triple", 1599), o("Single", 999)), addons(burgerSide, burgerExtras)),
				item("cheeseburger", "Cheeseburger Deluxe", 1399, "cheeseburger", "Single thick patty with cheddar, lettuce, tomato and mayo.", "beef, cheddar, lettuce, tomato, bun", allergen("WHEAT_TRITICALE", "MILK", "EGGS"), addons(burgerSide, burgerExtras)),
				item("mushroom", "Mushroom Swiss", 1499, "cheeseburger", "Sautéed mushrooms and Swiss cheese.", "beef, mushrooms, Swiss cheese, bun", allergen("WHEAT_TRITICALE", "MILK"), addons(burgerSide)),
				item("chicken-burger", "Crispy Chicken Burger", 1299, "chicken-burger", "Buttermilk fried chicken thigh, slaw and pickles.", "chicken, buttermilk, cabbage, bun", allergen("WHEAT_TRITICALE", "MILK", "EGGS"), addons(burgerSide)),
				item("veggie", "Black Bean Burger", 1199, "cheeseburger", "House black bean patty with avocado.", "black beans, oats, avocado, bun", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE"), addons(burgerSide)),
			),
			cat("Sides",
				item("fries", "Fries", 449, "fries", "Hand-cut, twice-fried.", "potato, salt", diet("VEGAN", "GLUTEN_FREE"), upsize("Size", o("Regular", 0), o("Large", 200))),
				item("onion-rings", "Onion Rings", 599, "onion-rings", "Beer-free batter, crisp.", "onion, wheat flour", diet("VEGAN"), allergen("WHEAT_TRITICALE")),
				item("poutine", "Classic Poutine", 899, "poutine", "Fries, Quebec cheese curds and gravy.", "potato, cheese curds, gravy", diet("VEGETARIAN"), allergen("MILK", "WHEAT_TRITICALE"),
					upsize("Size", o("Regular", 0), o("Large", 300))),
				item("loaded-fries", "Loaded Beef Fries", 1099, "fries", "Fries with chopped smash patty, cheese sauce and jalapeños.", "potato, beef, cheese, jalapeño", allergen("MILK"), spice(2)),
			),
			cat("Shakes",
				item("vanilla-shake", "Vanilla Bean Shake", 699, "milkshake", "Hand-spun.", "milk, vanilla ice cream", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("choc-shake", "Chocolate Shake", 699, "milkshake", "Hand-spun.", "milk, chocolate ice cream", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("pistachio-shake", "Pistachio Shake", 749, "milkshake", "With real pistachio paste.", "milk, ice cream, pistachio", diet("VEGETARIAN"), allergen("MILK", "TREE_NUTS"), outOfStock(24)),
			),
		},
	},
	{
		Slug: "levant-flame-shawarma", ID: "b0000000-0000-4000-8000-000000000307", OwnerID: "a0000000-0000-4000-8000-000000000307",
		Name:        "Levant Flame Shawarma",
		Description: "Shawarma carved off the spit on Broadview: chicken and beef, garlic toum, pickled turnips, house-baked pita.",
		Cuisines:    []string{"middle-eastern", "lebanese"}, Tags: "shawarma wrap plate falafel poutine",
		Line1: "330 Broadview Avenue", PostalCode: "M4M 2G9", Lat: 43.6637, Lng: -79.3520,
		PriceBand: "$", Rating: 4.5, RatingCount: 712, PrepMinutes: 15, MinOrder: 1000, Hours: hoursAllDay,
		CertDays: 180, Body: 0, Hero: "shawarma-plate", Palette: 9,
		Categories: []Category{
			cat("Wraps",
				item("chicken-wrap", "Chicken Shawarma Wrap", 1099, "shawarma-wrap", "Chicken, toum, pickles, turnips and fries in pita.", "chicken, pita, garlic, pickles", allergen("WHEAT_TRITICALE"),
					sizes("Size", o("Regular", 1099), o("Large", 1399)), addons(levantSauces, levantExtras)),
				item("beef-wrap", "Beef Shawarma Wrap", 1199, "shawarma-wrap", "Beef, tahini, tomato, onion and parsley.", "beef, pita, tahini, tomato", allergen("WHEAT_TRITICALE", "SESAME"),
					sizes("Size", o("Regular", 1199), o("Large", 1499)), addons(levantSauces, levantExtras)),
				item("falafel-wrap", "Falafel Wrap", 899, "falafel", "Falafel, tahini, salad and pickles.", "chickpeas, pita, tahini", diet("VEGAN"), allergen("WHEAT_TRITICALE", "SESAME"), addons(levantSauces)),
			),
			cat("Plates",
				item("chicken-plate", "Chicken Shawarma Plate", 1699, "shawarma-plate", "Rice or fries, salad, hummus, garlic sauce and pita.", "chicken, rice, hummus, garlic", allergen("WHEAT_TRITICALE", "SESAME"),
					addons(AddonGroup{Name: "Choose a base", Min: 1, Max: 1, Options: []Opt{o("Rice", 0), o("Fries", 0), o("Half and half", 0), o("Salad only", 0)}}, levantSauces, levantExtras)),
				item("beef-plate", "Beef Shawarma Plate", 1799, "shawarma-plate", "Beef shawarma with rice, salad and tahini.", "beef, rice, tahini", allergen("SESAME", "WHEAT_TRITICALE"), addons(levantSauces)),
				item("mixed-plate", "Mixed Shawarma Plate", 1899, "shawarma-plate", "Chicken and beef with all the sides.", "chicken, beef, rice, hummus", allergen("SESAME", "WHEAT_TRITICALE"), addons(levantSauces, levantExtras)),
				item("tawook", "Shish Tawook Plate", 1799, "shish-tawook", "Two chicken skewers off the grill.", "chicken, lemon, garlic", allergen("MILK")),
			),
			cat("Sides",
				item("shawarma-poutine", "Shawarma Poutine", 1199, "poutine", "Fries, curds, gravy and chicken shawarma with garlic sauce.", "potato, cheese curds, chicken, gravy", allergen("MILK", "WHEAT_TRITICALE")),
				item("garlic-potatoes", "Garlic Potatoes", 599, "fries", "Roasted potato wedges with toum.", "potato, garlic, lemon", diet("VEGAN", "GLUTEN_FREE")),
				item("hummus", "Hummus & Pita", 699, "hummus", "Classic hummus.", "chickpeas, tahini, pita", diet("VEGAN"), allergen("SESAME", "WHEAT_TRITICALE")),
				item("lentil", "Lentil Soup", 499, "lentil-soup", "Lebanese red lentil soup.", "lentils, onion, cumin", diet("VEGAN", "GLUTEN_FREE")),
			),
			cat("Drinks",
				item("ayran", "Laban Ayran", 349, "ayran", "Yogurt drink.", "yogurt, salt", diet("VEGETARIAN"), allergen("MILK")),
				item("can", "Soft Drink (can)", 249, "", "Assorted 355 ml cans.", "", diet("VEGAN")),
				item("mint-lemonade", "Mint Lemonade", 499, "mint-lemonade", "Frozen and blended.", "lemon, mint, sugar", diet("VEGAN")),
			),
		},
	},
	{
		Slug: "harbour-mezze-grill", ID: "b0000000-0000-4000-8000-000000000308", OwnerID: "a0000000-0000-4000-8000-000000000308",
		Name:        "Harbour Mezze Grill",
		Description: "Mediterranean grill near St. Lawrence Market: whole fish, lamb chops and souvlaki, with mezze to share.",
		Cuisines:    []string{"mediterranean"}, Tags: "souvlaki lamb chops fish greek salad mezze",
		Line1: "88 Front Street East", PostalCode: "M5E 1T4", Lat: 43.6488, Lng: -79.3720,
		PriceBand: "$$$", Rating: 4.6, RatingCount: 241, PrepMinutes: 30, MinOrder: 2000, Hours: hoursAllDay,
		CertDays: 330, Body: 1, Hero: "grilled-fish", Palette: 10,
		Categories: []Category{
			cat("To Share",
				item("mezze-platter", "Mezze Platter", 1999, "mezze", "Hummus, baba ghanoush, tzatziki, olives, falafel and warm pita.", "chickpeas, eggplant, yogurt, olives, pita", diet("VEGETARIAN"), allergen("SESAME", "MILK", "WHEAT_TRITICALE"),
					sizes("Size", o("For two", 1999), o("For four", 3499))),
				item("spanakopita", "Spanakopita", 899, "spanakopita", "Spinach and feta in crisp filo.", "filo, spinach, feta, egg", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK", "EGGS")),
				item("greek-salad", "Village Salad", 1299, "greek-salad", "Tomato, cucumber, onion, olives and a slab of feta.", "tomato, cucumber, olives, feta, oregano", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
			),
			cat("From the Grill",
				item("souvlaki", "Chicken Souvlaki Dinner", 2199, "souvlaki", "Two skewers with lemon potatoes, rice, salad and tzatziki.", "chicken, lemon, oregano, potato, yogurt", allergen("MILK"),
					addons(AddonGroup{Name: "Add a side", Min: 0, Max: 2, Options: []Opt{o("Extra tzatziki", 199), o("Grilled pita", 199), o("Lemon potatoes", 499)}})),
				item("lamb-chops", "Lamb Chops", 3499, "lamb-chops", "Four chops, grilled to order, with lemon potatoes.", "lamb, garlic, rosemary, potato", diet("GLUTEN_FREE"),
					addons(AddonGroup{Name: "Cooked", Min: 1, Max: 1, Options: []Opt{o("Medium rare", 0), o("Medium", 0), o("Well done", 0)}})),
				item("sea-bream", "Whole Grilled Sea Bream", 3299, "grilled-fish", "Charcoal grilled with ladolemono, greens and potatoes.", "sea bream, olive oil, lemon, greens", diet("GLUTEN_FREE"), allergen("FISH")),
				item("kofta", "Beef Kofta", 2099, "lamb-kebab", "Spiced beef skewers with rice and salad.", "beef, onion, parsley", allergen("WHEAT_TRITICALE")),
				item("salmon", "Grilled Salmon", 2899, "grilled-fish", "Atlantic salmon with herbed rice.", "salmon, rice, herbs", diet("GLUTEN_FREE"), allergen("FISH"), outOfStock(0)),
			),
			cat("Soups",
				item("avgolemono", "Lemon Chicken Soup", 799, "lentil-soup", "Chicken, rice and lemon-egg broth.", "chicken, rice, egg, lemon", diet("GLUTEN_FREE"), allergen("EGGS")),
				item("fasolada", "Bean Soup", 699, "lentil-soup", "White beans, tomato and celery.", "white beans, tomato, celery", diet("VEGAN", "GLUTEN_FREE")),
			),
			cat("Dessert",
				item("baklava", "Walnut Baklava", 799, "baklava", "With honey syrup.", "filo, walnut, honey", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "TREE_NUTS", "MILK")),
				item("yogurt-honey", "Greek Yogurt & Honey", 699, "kheer", "Strained yogurt, thyme honey and walnuts.", "yogurt, honey, walnuts", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS")),
			),
		},
	},
	{
		Slug: "rose-water-desserts", ID: "b0000000-0000-4000-8000-000000000309", OwnerID: "a0000000-0000-4000-8000-000000000309",
		Name:        "Rose Water Desserts",
		Description: "Late-night desserts on the Danforth: künefe, falooda, gulab jamun, waffles and saffron ice cream. Opens at noon.",
		Cuisines:    []string{"desserts", "beverages"}, Tags: "kunefe falooda waffles ice cream baklava",
		Line1: "1580 Danforth Avenue", PostalCode: "M4C 1H7", Lat: 43.6838, Lng: -79.3225,
		PriceBand: "$$", Rating: 4.8, RatingCount: 365, PrepMinutes: 10, MinOrder: 800, Hours: hoursAfternoon,
		CertDays: 350, Body: 2, Hero: "kunefe", Palette: 11,
		Categories: []Category{
			cat("Warm Desserts",
				item("kunefe", "Künefe", 1199, "kunefe", "Crisp kadayıf over stretchy cheese, soaked in syrup.", "kadayıf, cheese, butter, syrup", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK"),
					sizes("Size", o("Single", 1199), o("To share", 1899)), addons(dessertTop)),
				item("gulab-jamun", "Gulab Jamun", 599, "gulab-jamun", "Warm, in rose and cardamom syrup.", "milk solids, sugar, cardamom, rose", diet("VEGETARIAN"), allergen("MILK", "WHEAT_TRITICALE"),
					sizes("Pieces", o("3 pieces", 599), o("6 pieces", 999)), addons(dessertTop)),
				item("jalebi", "Jalebi", 599, "jalebi", "Fried to order and dipped in saffron syrup.", "wheat flour, yogurt, saffron, sugar", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "MILK")),
				item("waffle", "Belgian Waffle", 1099, "waffles", "With chocolate sauce, berries and cream.", "wheat flour, eggs, milk, chocolate, berries", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "EGGS", "MILK"), addons(dessertTop)),
				item("crepe", "Chocolate Hazelnut Crêpe", 999, "crepe", "Thin crêpe with chocolate hazelnut spread and banana.", "wheat flour, eggs, milk, hazelnut, chocolate", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "EGGS", "MILK", "TREE_NUTS")),
			),
			cat("Cold Desserts",
				item("falooda", "Royal Falooda", 899, "falooda", "Rose milk, vermicelli, basil seeds, jelly and kulfi.", "milk, rose syrup, vermicelli, basil seeds, kulfi", diet("VEGETARIAN"), allergen("MILK", "WHEAT_TRITICALE")),
				item("rasmalai", "Rasmalai", 699, "rasmalai", "Saffron milk and pistachio.", "milk, saffron, pistachio", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS")),
				item("bastani", "Saffron Ice Cream", 699, "", "Saffron and rose water ice cream with pistachio.", "milk, cream, saffron, rose water, pistachio", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS"),
					sizes("Scoops", o("Two scoops", 699), o("Three scoops", 899))),
				item("tres-leches", "Pistachio Tres Leches", 849, "tres-leches", "Sponge soaked in three milks.", "flour, eggs, milk, cream, pistachio", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "EGGS", "MILK", "TREE_NUTS")),
				item("cheesecake", "Mango Cheesecake", 799, "cheesecake", "Baked cheesecake with mango glaze.", "cream cheese, eggs, mango, biscuit", diet("VEGETARIAN"), allergen("MILK", "EGGS", "WHEAT_TRITICALE"), outOfStock(0)),
			),
			cat("Baklava Box",
				item("baklava-box", "Baklava Box", 1499, "baklava", "Assorted baklava.", "filo, pistachio, walnut, butter, syrup", diet("VEGETARIAN"), allergen("WHEAT_TRITICALE", "TREE_NUTS", "MILK"),
					sizes("Box", o("12 pieces", 1499), o("24 pieces", 2699))),
			),
			cat("Drinks",
				item("karak", "Karak Chai", 349, "masala-chai", "Strong spiced milk tea.", "tea, milk, cardamom", diet("VEGETARIAN"), allergen("MILK")),
				item("mango-lassi", "Mango Lassi", 599, "mango-lassi", "Thick and cold.", "mango, yogurt", diet("VEGETARIAN"), allergen("MILK")),
				item("turkish-tea", "Turkish Tea", 249, "turkish-tea", "Brewed in a double kettle.", "black tea", diet("VEGAN")),
			),
		},
	},
	{
		Slug: "padma-river-kitchen", ID: "b0000000-0000-4000-8000-000000000310", OwnerID: "a0000000-0000-4000-8000-000000000310",
		Name:        "Padma River Kitchen",
		Description: "Bangladeshi kitchen in Little India: kacchi biryani, bhuna khichuri, fish curries and borhani. Closed today; opens again tomorrow.",
		Cuisines:    []string{"bangladeshi", "indian"}, Tags: "kacchi biryani khichuri fish curry bhorta",
		Line1: "1510 Gerrard Street East", PostalCode: "M4L 2A4", Lat: 43.6734, Lng: -79.3172,
		PriceBand: "$$", Rating: 4.5, RatingCount: 133, PrepMinutes: 30, MinOrder: 1500, Hours: hoursClosedToday,
		CertDays: 280, Body: 0, Hero: "kacchi-biryani", Palette: 12,
		Categories: []Category{
			cat("Biryani & Rice",
				item("kacchi", "Mutton Kacchi Biryani", 1999, "kacchi-biryani", "Mutton and potato cooked raw with chinigura rice, Dhaka style.", "mutton, chinigura rice, potato, ghee, saffron", allergen("MILK"),
					sizes("Size", o("Single", 1999), o("Full (serves 2)", 3499)), addons(AddonGroup{Name: "Add", Min: 0, Max: 3, Options: []Opt{o("Borhani", 349), o("Jali kabab", 349), o("Boiled egg", 149)}})),
				item("khichuri", "Bhuna Khichuri with Beef", 1599, "khichuri", "Rice and lentils cooked with beef bhuna.", "rice, moong dal, beef, ghee", allergen("MILK")),
				item("tehari", "Beef Tehari", 1599, "biryani", "Small cubes of beef with aromatic rice and green chili.", "beef, rice, mustard oil, green chili", allergen("MUSTARD"), spice(3)),
			),
			cat("Curries",
				item("beef-bhuna", "Beef Bhuna", 1699, "beef-bhuna", "Dry-fried beef curry with onion and whole spices.", "beef, onion, garlic, whole spices", diet("GLUTEN_FREE"), spice(3)),
				item("rui", "Rui Fish Curry", 1799, "fish-curry", "Rohu fish in a light tomato and cumin gravy.", "rohu fish, tomato, cumin, turmeric", diet("GLUTEN_FREE"), allergen("FISH")),
				item("chicken-roast", "Chicken Roast", 1599, "butter-chicken", "Wedding-style chicken roast in a rich, sweet gravy.", "chicken, yogurt, ghee, onion", allergen("MILK")),
				item("dal", "Masoor Dal", 899, "daal", "Red lentils with garlic tempering.", "red lentils, garlic, turmeric", diet("VEGAN", "GLUTEN_FREE")),
			),
			cat("Bhorta & Snacks",
				item("bhorta", "Bhorta Trio", 999, "bhorta", "Mashed eggplant, potato and dried fish with mustard oil.", "eggplant, potato, dried fish, mustard oil", allergen("FISH", "MUSTARD"), spice(3)),
				item("shingara", "Shingara (3 pc)", 599, "shingara", "Potato and peanut filled pastry.", "wheat flour, potato, peanuts", diet("VEGAN"), allergen("WHEAT_TRITICALE", "PEANUTS")),
				item("chotpoti", "Chotpoti", 799, "chotpoti", "Spiced yellow peas with egg, tamarind and onion.", "yellow peas, egg, tamarind, onion", allergen("EGGS"), spice(2)),
			),
			cat("Dessert & Drinks",
				item("mishti-doi", "Mishti Doi", 499, "mishti-doi", "Sweet set yogurt in a clay pot.", "milk, sugar, culture", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("borhani", "Borhani", 349, "borhani", "Spiced yogurt drink with mint.", "yogurt, mint, black salt, mustard", diet("VEGETARIAN"), allergen("MILK", "MUSTARD")),
				item("firni", "Firni", 499, "firni", "Ground rice pudding.", "rice, milk, cardamom", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
			),
		},
	},
	{
		Slug: "golestan-kabob-house", ID: "b0000000-0000-4000-8000-000000000311", OwnerID: "a0000000-0000-4000-8000-000000000311",
		Name:        "Golestan Kabob House",
		Description: "Persian kabobs on Pape Avenue: koobideh and joojeh off the charcoal, saffron rice with tahdig, stews on weekends.",
		Cuisines:    []string{"persian", "middle-eastern"}, Tags: "koobideh joojeh tahdig ghormeh sabzi",
		Line1: "845 Pape Avenue", PostalCode: "M4K 3T5", Lat: 43.6871, Lng: -79.3460,
		PriceBand: "$$", Rating: 4.7, RatingCount: 298, PrepMinutes: 25, MinOrder: 1500, Hours: hoursAllDay,
		CertDays: 240, Body: 1, Hero: "koobideh", Palette: 13,
		Categories: []Category{
			cat("Kabobs",
				item("koobideh", "Koobideh Kabob", 1899, "koobideh", "Two skewers of ground beef and lamb with saffron rice and grilled tomato.", "beef, lamb, onion, saffron rice, tomato", diet("GLUTEN_FREE"),
					sizes("Skewers", o("Two skewers", 1899), o("Three skewers", 2399)), addons(riceSide)),
				item("joojeh", "Joojeh Kabob", 1999, "joojeh", "Saffron and lemon chicken, boneless.", "chicken, saffron, lemon, onion", diet("GLUTEN_FREE"),
					sizes("Cut", o("Boneless", 1999), o("Bone-in", 1899)), addons(riceSide)),
				item("barg", "Barg Kabob", 2899, "lamb-kebab", "Thin-cut beef tenderloin marinated in onion and saffron.", "beef tenderloin, onion, saffron", diet("GLUTEN_FREE"), addons(riceSide)),
				item("soltani", "Soltani", 3299, "koobideh", "One barg and one koobideh.", "beef, lamb, saffron rice", diet("GLUTEN_FREE"), addons(riceSide)),
			),
			cat("Stews",
				item("ghormeh-sabzi", "Ghormeh Sabzi", 1799, "ghormeh-sabzi", "Herb stew with kidney beans, dried lime and beef.", "parsley, fenugreek, kidney beans, beef, dried lime", diet("GLUTEN_FREE")),
				item("gheimeh", "Gheimeh", 1799, "ghormeh-sabzi", "Split pea and beef stew with crisp potatoes.", "split peas, beef, tomato, potato", diet("GLUTEN_FREE"), outOfStock(12)),
			),
			cat("Starters & Sides",
				item("tahdig", "Tahdig with Stew", 999, "tahdig", "The crisp rice from the bottom of the pot, with a ladle of stew.", "rice, saffron, oil", diet("GLUTEN_FREE")),
				item("kashk", "Kashk-e Bademjan", 999, "kashk-bademjan", "Eggplant dip with whey, fried mint and walnuts.", "eggplant, kashk, mint, walnuts", diet("VEGETARIAN"), allergen("MILK", "TREE_NUTS")),
				item("shirazi", "Shirazi Salad", 699, "shirazi-salad", "Cucumber, tomato and onion with lime and dried mint.", "cucumber, tomato, onion, lime", diet("VEGAN", "GLUTEN_FREE")),
				item("saffron-rice", "Saffron Rice", 499, "saffron-rice", "Chelow with saffron and butter.", "basmati rice, saffron, butter", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
			),
			cat("Drinks & Dessert",
				item("doogh", "Doogh", 399, "doogh", "Sparkling mint yogurt drink.", "yogurt, mint, soda", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK")),
				item("bastani", "Bastani Sonnati", 699, "", "Saffron rosewater ice cream with pistachio.", "milk, saffron, rose water, pistachio", diet("VEGETARIAN", "GLUTEN_FREE"), allergen("MILK", "TREE_NUTS")),
				item("chai", "Persian Tea", 299, "turkish-tea", "Black tea with cardamom.", "black tea, cardamom", diet("VEGAN")),
			),
		},
	},
}
