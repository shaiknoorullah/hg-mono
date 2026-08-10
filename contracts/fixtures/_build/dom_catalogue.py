"""Discovery, restaurant detail, menu, cart and quote fixtures."""

from __future__ import annotations

from content import DISHES, IMAGE_BASE, LONG_DISH_NAME, LONG_RESTAURANT_NAME, HOUR, MINUTE, ts
from money import order_lines_from_quote, price_quote, quote_line
from synth import uuid_for
from world import (
    addon_group,
    address,
    availability,
    certification_panel,
    halal_badge,
    menu_category,
    menu_item,
    public_address,
    restaurant_card,
    restaurant_detail,
    slug,
    trading_hours,
    variant_group,
)

KARACHI = "karachi-kitchen"


def build(reg, synth) -> None:
    _restaurants(reg)
    _menus(reg, synth)
    _certification(reg)
    _cart(reg)
    _quotes(reg)
    _search_and_feed(reg, synth)


# --------------------------------------------------------------------------- #
# Restaurant lists and detail
# --------------------------------------------------------------------------- #


def _restaurants(reg) -> None:
    cards = [restaurant_card(i) for i in range(12)]
    cards[3]["halal"] = halal_badge("EXPIRING_SOON")
    reg.add(
        "restaurant_list_populated",
        "catalogue",
        "array<RestaurantCard>",
        "Twelve open, certified Ontario restaurants — the default browse screen. One card "
        "(index 3) is EXPIRING_SOON so the badge variant is always on screen.",
        cards,
        operations=["listRestaurants"],
        meta={"next_cursor": "01K4S9ZC0F8V7Q2R3T5Y6M8N9P", "has_more": True, "total": 47},
    )

    reg.add(
        "restaurant_list_single",
        "catalogue",
        "array<RestaurantCard>",
        "Exactly one result. Catches layouts that only look right with a full grid, and "
        "'showing 1 of 1' copy that pluralises wrongly.",
        [restaurant_card(0)],
        operations=["listRestaurants"],
        meta={"next_cursor": None, "has_more": False, "total": 1},
        tags=["edge"],
    )

    reg.add(
        "restaurant_list_empty",
        "catalogue",
        "array<RestaurantCard>",
        "Zero results — no halal kitchen serves this postal code yet. The empty state, not "
        "an error.",
        [],
        operations=["listRestaurants"],
        meta={"next_cursor": None, "has_more": False, "total": 0},
        tags=["edge", "empty"],
    )

    overflow = restaurant_card(1)
    overflow.update(
        {
            "id": uuid_for("restaurant:long-name"),
            "name": LONG_RESTAURANT_NAME,
            "slug": slug(LONG_RESTAURANT_NAME),
            "cuisines": [
                "Mediterranean",
                "Middle Eastern",
                "Shawarma",
                "Charcoal Grill",
                "Family Style",
                "Halal",
            ],
        }
    )
    long_dish_host = restaurant_card(4)
    long_dish_host["name"] = "Tandoori Flame — Bramalea City Centre (Upper Level, Food Court Entrance)"
    reg.add(
        "restaurant_list_long_names",
        "catalogue",
        "array<RestaurantCard>",
        "Names and cuisine lists that overflow one line at every breakpoint. Truncation, "
        "wrapping and the accessible full name all have to survive this.",
        [overflow, long_dish_host, restaurant_card(0)],
        operations=["listRestaurants"],
        meta={"next_cursor": None, "has_more": False, "total": 3},
        tags=["edge", "overflow"],
    )

    no_images = [
        restaurant_card(i, hero_image_url=None, logo_image_url=None) for i in range(4)
    ]
    no_images[0]["rating_avg"] = None
    no_images[0]["rating_count"] = 0
    no_images[0]["price_band"] = None
    reg.add(
        "restaurant_list_missing_images",
        "catalogue",
        "array<RestaurantCard>",
        "No hero, no logo, and on the first card no rating and no price band either — a "
        "kitchen that went live this morning. Every image slot must have a placeholder.",
        no_images,
        operations=["listRestaurants"],
        meta={"next_cursor": None, "has_more": False, "total": 4},
        tags=["edge", "missing-media"],
    )

    for state, describes in [
        ("OPEN", "Open and accepting, with a live ETA band."),
        ("CLOSED_HOURS", "Outside trading hours — `opens_at` is tomorrow 11:00 local, no ETA."),
        ("PAUSED", "Kitchen paused itself (R-22 short pause). Still listed, cannot be ordered from."),
        ("OUT_OF_RANGE", "21.4 km from the saved address; carries `out_of_range_reason` copy."),
        ("NO_ADDRESS", "Customer has no address yet, so nothing distance-derived can be computed."),
    ]:
        reg.add(
            f"restaurant_availability_{state.lower()}",
            "catalogue",
            "RestaurantAvailabilityInfo",
            describes,
            availability(state),
            tags=["state-matrix"],
        )

    for halal_state in ["CERTIFIED", "EXPIRING_SOON", "EXPIRED", "UNVERIFIED"]:
        note = {
            "CERTIFIED": "Full badge, certificate viewable, 211 days of validity left.",
            "EXPIRING_SOON": "Certificate expires in 18 days — badge shows the countdown, "
            "the restaurant keeps trading.",
            "EXPIRED": "Expired 9 days ago. **Customer read paths 404 this restaurant** "
            "(contradiction log #19) — the fixture exists for the admin and owner surfaces.",
            "UNVERIFIED": "No accepted certificate on file. Never customer-visible; "
            "`SELF_DECLARED` does not exist in this contract (decision O-06).",
        }[halal_state]
        reg.add(
            f"restaurant_detail_{halal_state.lower()}",
            "catalogue",
            "RestaurantDetail",
            f"Restaurant detail with `halal.display_state = {halal_state}`. {note}",
            restaurant_detail(0, halal_state=halal_state),
            operations=["getRestaurant"],
            tags=["state-matrix", "halal"],
        )

    reg.add(
        "restaurant_detail_no_menu",
        "catalogue",
        "RestaurantDetail",
        "An approved restaurant that has not published a single menu item. Pair with "
        "`menu_empty`. The detail screen must not assume a menu exists.",
        restaurant_detail(
            5,
            description=None,
            hero_image_url=None,
            public_phone_e164=None,
        ),
        operations=["getRestaurant"],
        tags=["edge", "empty"],
    )

    reg.add(
        "restaurant_detail_closed",
        "catalogue",
        "RestaurantDetail",
        "Detail page for a kitchen that is closed right now. Ordering is blocked; the hours "
        "table and the 'opens at' line are the whole screen.",
        restaurant_detail(2, availability=availability("CLOSED_HOURS")),
        operations=["getRestaurant"],
        tags=["state-matrix"],
    )

    reg.add(
        "restaurant_hours_standard",
        "catalogue",
        "RestaurantHours",
        "Mon–Thu 11:00–22:00, Fri–Sat 11:00–01:00 (crosses midnight), Sun 12:00–21:00, plus "
        "one closed-for-Eid override.",
        {
            "timezone": "America/Toronto",
            "intervals": trading_hours(),
            "overrides": [
                {
                    "date": "2027-03-20",
                    "is_closed": True,
                    "opens_at": None,
                    "closes_at": None,
                    "reason": "Closed for Eid al-Fitr",
                },
                {
                    "date": "2026-12-25",
                    "is_closed": False,
                    "opens_at": "16:00",
                    "closes_at": "22:00",
                    "reason": "Late opening on 25 December",
                },
            ],
        },
        operations=["getRestaurantHours", "setRestaurantHours"],
    )


# --------------------------------------------------------------------------- #
# Menus
# --------------------------------------------------------------------------- #


def _loaded_item() -> dict:
    """A menu item with many variants and many add-on groups — the worst case for the
    item sheet: scrolling, required-selection validation, price recomputation."""
    item = menu_item(3)  # Lamb Shawarma Platter
    item["id"] = uuid_for("item:karachi-kitchen:loaded")
    item["name"] = "Mixed Charcoal Grill Platter"
    item["description"] = (
        "Chicken tikka, seekh kebab, lamb chop and malai boti over saffron rice, with "
        "grilled tomato, naan and three chutneys. Built to share."
    )
    item["price_cents"] = 2499
    item["prep_minutes"] = 26
    item["variant_groups"] = [
        variant_group(
            "loaded:size",
            "Platter size",
            [
                ("For one", "ABSOLUTE", 2499, None, True, True),
                ("For two", "ABSOLUTE", 4299, None, False, True),
                ("Family (serves 4)", "ABSOLUTE", 7899, None, False, True),
                ("Party tray (serves 8–10)", "ABSOLUTE", 14999, None, False, False),
            ],
            required=True,
        ),
        variant_group(
            "loaded:rice",
            "Rice",
            [
                ("Saffron basmati", "DELTA", None, 0, True, True),
                ("Kabuli pulao", "DELTA", None, 300, False, True),
                ("Garlic butter rice", "DELTA", None, 250, False, True),
                ("Swap rice for salad", "DELTA", None, 0, False, True),
                ("No rice", "DELTA", None, -200, False, True),
            ],
            required=True,
        ),
        variant_group(
            "loaded:heat",
            "Heat level",
            [
                ("Mild", "DELTA", None, 0, True, True),
                ("Medium", "DELTA", None, 0, False, True),
                ("Hot", "DELTA", None, 0, False, True),
                ("Peshawari hot", "DELTA", None, 0, False, True),
            ],
            required=True,
        ),
    ]
    item["addon_groups"] = [
        addon_group(
            "loaded:breads",
            "Breads",
            [
                ("Plain naan", 249, True),
                ("Garlic naan", 349, True),
                ("Roghni naan", 399, True),
                ("Tandoori roti", 199, True),
                ("Paratha", 349, False),
            ],
            min_select=0,
            max_select=6,
        ),
        addon_group(
            "loaded:sauces",
            "Chutneys and sauces",
            [
                ("Garlic toum", 149, True),
                ("Mint raita", 149, True),
                ("Imli (tamarind) chutney", 149, True),
                ("Peri sauce", 199, True),
                ("Extra green chilli", 99, True),
            ],
            min_select=1,
            max_select=5,
        ),
        addon_group(
            "loaded:extras",
            "Add a skewer",
            [
                ("Extra seekh kebab", 599, True),
                ("Extra malai boti", 699, True),
                ("Extra lamb chop", 899, False),
            ],
            min_select=0,
            max_select=3,
        ),
        addon_group(
            "loaded:drinks",
            "Make it a meal",
            [
                ("Mango lassi", 549, True),
                ("Salted lassi", 499, True),
                ("Kashmiri chai", 449, True),
            ],
            min_select=0,
            max_select=2,
        ),
    ]
    return item


def _menus(reg, synth) -> None:
    grill = [menu_item(i) for i in (0, 1, 2)]
    grill[1]["variant_groups"] = [
        variant_group(
            "nihari:size",
            "Portion",
            [
                ("Half", "ABSOLUTE", 2145, None, True, True),
                ("Full", "ABSOLUTE", 3695, None, False, True),
            ],
        )
    ]
    kebabs = [menu_item(i) for i in (3, 6, 7, 9, 10)]
    kebabs[0]["addon_groups"] = [
        addon_group("shawarma:extras", "Extras", [("Garlic toum", 149, True), ("Extra pickles", 99, True)])
    ]
    sweets = [menu_item(i) for i in (13, 14, 12)]
    sweets[2]["availability_state"] = "OUT_OF_STOCK"
    sweets[2]["out_of_stock_until"] = ts(4 * HOUR)

    full_menu = {
        "restaurant_id": uuid_for(f"restaurant:{KARACHI}"),
        "categories": [
            menu_category(0, grill),
            menu_category(1, kebabs + [_loaded_item()]),
            menu_category(5, sweets),
        ],
    }
    reg.add(
        "menu_full",
        "catalogue",
        "Menu",
        "Three categories, twelve items, one out-of-stock dessert and the "
        "many-variant/many-addon platter. The default menu for every app.",
        full_menu,
        operations=["getRestaurantMenu"],
    )

    reg.add(
        "menu_empty",
        "catalogue",
        "Menu",
        "A restaurant with **no menu at all** — approved, live, zero categories. Pair with "
        "`restaurant_detail_no_menu`.",
        {"restaurant_id": uuid_for("restaurant:no-menu"), "categories": []},
        operations=["getRestaurantMenu"],
        tags=["edge", "empty"],
    )

    reg.add(
        "menu_single_item",
        "catalogue",
        "Menu",
        "Exactly one category holding exactly one item. Catches carousels that need at "
        "least two children and 'N items' copy that pluralises wrongly.",
        {
            "restaurant_id": uuid_for("restaurant:single-item"),
            "categories": [menu_category(0, [menu_item(0)])],
        },
        operations=["getRestaurantMenu"],
        tags=["edge"],
    )

    long_item = menu_item(1)
    long_item["id"] = uuid_for("item:long-name")
    long_item["name"] = LONG_DISH_NAME
    long_item["description"] = (
        "Our nihari is started at nine the night before and never leaves the pot until "
        "service. The shank is cut to order, the marrow is spooned over at the pass, and "
        "the gravy is thickened with nothing but atta and time. Comes with two house naan "
        "from the tandoor, a pickled onion salad dressed with lime and green chilli, and "
        "both the mint and the imli chutney. If you want it hotter, ask — we will not be "
        "offended, and the kitchen keeps a separate pot of Peshawari heat for exactly this."
    )
    long_item["image_url"] = None
    reg.add(
        "menu_item_long_name_no_image",
        "catalogue",
        "MenuItem",
        "A 150-character dish name, a six-line description and **no image**. The item row, "
        "the item sheet and the cart line all have to survive it.",
        long_item,
        tags=["edge", "overflow", "missing-media"],
    )

    reg.add(
        "menu_item_many_variants_and_addons",
        "catalogue",
        "MenuItem",
        "Three required variant groups (16 variants, one unavailable) and four add-on "
        "groups (16 add-ons, two unavailable, one group with `min_select: 1`). The item "
        "sheet's hardest case.",
        _loaded_item(),
        tags=["edge", "dense"],
    )

    for state, note in [
        ("AVAILABLE", "Orderable now."),
        ("OUT_OF_STOCK", "86'd until 22:42 local; still rendered, marked unavailable, never hidden (R-19)."),
        ("HIDDEN", "Owner-hidden. Absent from customer reads; visible in the owner's menu editor."),
        ("BLOCKED", "Blocked by an admin after a menu review. The owner cannot un-block it."),
    ]:
        item = menu_item(0)
        item["availability_state"] = state
        item["out_of_stock_until"] = ts(4 * HOUR) if state == "OUT_OF_STOCK" else None
        reg.add(
            f"menu_item_{state.lower()}",
            "catalogue",
            "MenuItem",
            f"`availability_state = {state}`. {note}",
            item,
            tags=["state-matrix"],
        )

    owner_item = synth.make("MenuItemOwnerView", "owner-item")
    owner_item.update(menu_item(0))
    owner_item["category_id"] = uuid_for("category:biryani-and-rice")
    owner_item["sort_order"] = 1
    reg.add(
        "owned_menu_with_pending_version",
        "catalogue",
        "OwnedMenu",
        "The restaurant's own menu. One item carries a `pending_version` — a claim-bearing "
        "field (description) was edited and is queued for review, while price and "
        "availability already went live unreviewed (decision R-05).",
        {
            "restaurant_id": uuid_for(f"restaurant:{KARACHI}"),
            "categories": [
                {
                    **menu_category(0, []),
                    "items": [
                        owner_item,
                        {
                            **synth.make("MenuItemOwnerView", "owner-item-2"),
                            **menu_item(1),
                            "category_id": uuid_for("category:biryani-and-rice"),
                            "sort_order": 2,
                            "pending_version": None,
                        },
                    ],
                }
            ],
        },
        operations=["getOwnMenu"],
    )


def _certification(reg) -> None:
    for state in ["CERTIFIED", "EXPIRING_SOON", "EXPIRED", "UNVERIFIED"]:
        reg.add(
            f"certification_panel_{state.lower()}",
            "halal",
            "CertificationPanel",
            f"The customer-facing certification panel in `{state}`.",
            certification_panel(state),
            operations=["getRestaurantCertification"],
            tags=["halal", "state-matrix"],
        )


# --------------------------------------------------------------------------- #
# Cart
# --------------------------------------------------------------------------- #


def _cart_line(index: int, item: dict, quantity: int, **over) -> dict:
    line = {
        "id": uuid_for(f"cartline:{index}:{item['id']}"),
        "menu_item_id": item["id"],
        "name": item["name"],
        "image_url": item["image_url"],
        "variant": None,
        "addons": [],
        "quantity": quantity,
        "special_request": None,
        "unit_price_cents": item["price_cents"],
        "line_total_cents": item["price_cents"] * quantity,
        "currency": "CAD",
        "availability": {"is_available": True, "reason": None, "current_price_cents": None},
    }
    line.update(over)
    return line


def _cart(reg) -> None:
    card = restaurant_card(0)
    items = [menu_item(i) for i in range(3)]

    empty = {
        "id": uuid_for("cart:empty"),
        "restaurant": None,
        "delivery_address_id": None,
        "lines": [],
        "item_count": 0,
        "indicative_subtotal_cents": 0,
        "currency": "CAD",
        "is_quotable": False,
        "blocking_reasons": [],
    }
    reg.add(
        "cart_empty",
        "cart",
        "Cart",
        "No lines, no restaurant pinned. `is_quotable: false` with an empty "
        "`blocking_reasons` — nothing is wrong, there is simply nothing in it.",
        empty,
        operations=["getCart", "clearCart"],
        tags=["edge", "empty"],
    )

    single = _cart_line(0, items[0], 1)
    reg.add(
        "cart_single_line",
        "cart",
        "Cart",
        "Exactly one line, quantity 1, below the $15.00 minimum order — "
        "`blocking_reasons: [BELOW_MINIMUM_ORDER]`.",
        {
            "id": uuid_for("cart:single"),
            "restaurant": card,
            "delivery_address_id": uuid_for("address:home"),
            "lines": [single],
            "item_count": 1,
            "indicative_subtotal_cents": single["line_total_cents"],
            "currency": "CAD",
            "is_quotable": False,
            "blocking_reasons": ["BELOW_MINIMUM_ORDER"],
        },
        operations=["getCart", "addCartLine"],
        tags=["edge"],
    )

    capped = _cart_line(
        1,
        items[0],
        20,
        special_request="Please pack the raita separately, we are driving it to Guelph.",
    )
    reg.add(
        "cart_at_quantity_cap",
        "cart",
        "Cart",
        "A line at the hard cap of **20** (contradiction log #21 — the customer spec's "
        "1–20 wins over P-36's passing mention of 99). The stepper's `+` must be disabled.",
        {
            "id": uuid_for("cart:cap"),
            "restaurant": card,
            "delivery_address_id": uuid_for("address:home"),
            "lines": [capped],
            "item_count": 20,
            "indicative_subtotal_cents": capped["line_total_cents"],
            "currency": "CAD",
            "is_quotable": True,
            "blocking_reasons": [],
        },
        operations=["getCart", "updateCartLine"],
        tags=["edge", "boundary"],
    )

    unavailable_lines = [
        _cart_line(2, items[0], 2),
        _cart_line(
            3,
            items[1],
            1,
            availability={
                "is_available": False,
                "reason": "OUT_OF_STOCK",
                "current_price_cents": None,
            },
        ),
        _cart_line(
            4,
            items[2],
            1,
            availability={
                "is_available": False,
                "reason": "PRICE_CHANGED",
                "current_price_cents": items[2]["price_cents"] + 200,
            },
        ),
    ]
    reg.add(
        "cart_has_unavailable_items",
        "cart",
        "Cart",
        "Three lines: one fine, one 86'd, one repriced upward since it was added. "
        "`blocking_reasons: [CART_HAS_UNAVAILABLE_ITEMS, PRICE_CHANGED]` and "
        "`is_quotable: false`. This is the error code that used to be spelled "
        "`cart_has_unavailable_items` before the normalisation.",
        {
            "id": uuid_for("cart:unavailable"),
            "restaurant": card,
            "delivery_address_id": uuid_for("address:home"),
            "lines": unavailable_lines,
            "item_count": 4,
            "indicative_subtotal_cents": sum(l["line_total_cents"] for l in unavailable_lines),
            "currency": "CAD",
            "is_quotable": False,
            "blocking_reasons": ["CART_HAS_UNAVAILABLE_ITEMS", "PRICE_CHANGED"],
        },
        operations=["getCart"],
        tags=["error-path"],
    )

    loaded = _loaded_item()
    dense = _cart_line(
        5,
        loaded,
        2,
        variant={
            "variant_id": uuid_for("variant:loaded:size:family-serves-4"),
            "name": "Family (serves 4)",
            "pricing_mode": "ABSOLUTE",
        },
        addons=[
            {"addon_id": uuid_for("addon:loaded:breads:garlic-naan"), "name": "Garlic naan", "quantity": 4},
            {"addon_id": uuid_for("addon:loaded:sauces:garlic-toum"), "name": "Garlic toum", "quantity": 2},
            {"addon_id": uuid_for("addon:loaded:extras:extra-seekh-kebab"), "name": "Extra seekh kebab", "quantity": 1},
        ],
        unit_price_cents=7899 + 4 * 349 + 2 * 149 + 599,
        line_total_cents=2 * (7899 + 4 * 349 + 2 * 149 + 599),
        special_request="No coriander on anything, please — allergy in the house.",
    )
    other = [_cart_line(i, items[i % 3], (i % 3) + 1) for i in range(6, 11)]
    reg.add(
        "cart_many_lines",
        "cart",
        "Cart",
        "Six lines including a family platter with a variant, three add-on groups and a "
        "special request. Tests the cart's densest row and the sticky total bar.",
        {
            "id": uuid_for("cart:many"),
            "restaurant": card,
            "delivery_address_id": uuid_for("address:home"),
            "lines": [dense, *other],
            "item_count": sum(l["quantity"] for l in [dense, *other]),
            "indicative_subtotal_cents": sum(l["line_total_cents"] for l in [dense, *other]),
            "currency": "CAD",
            "is_quotable": True,
            "blocking_reasons": [],
        },
        operations=["getCart"],
        tags=["dense"],
    )


# --------------------------------------------------------------------------- #
# Quotes
# --------------------------------------------------------------------------- #


def _quote(label: str, lines: list[dict], *, tip_cents: int, fulfilment: str = "DELIVERY", discount=None, **over) -> dict:
    priced = price_quote(lines, tip_cents=tip_cents, fulfilment=fulfilment, discount=discount)
    out = {
        "id": uuid_for(f"quote:{label}"),
        "cart_id": uuid_for("cart:many"),
        "restaurant_id": uuid_for(f"restaurant:{KARACHI}"),
        "delivery_address_id": None if fulfilment == "PICKUP" else uuid_for("address:home"),
        "fulfilment": fulfilment,
        "currency": "CAD",
        "lines": lines,
        "subtotal_cents": priced["subtotal_cents"],
        "discount_items_cents": priced["discount_items_cents"],
        "discount_delivery_cents": priced["discount_delivery_cents"],
        "discount_service_cents": priced["discount_service_cents"],
        "discount": discount,
        "delivery_fee_cents": priced["delivery_fee_cents"],
        "service_fee_cents": priced["service_fee_cents"],
        "tax_lines": priced["tax_lines"],
        "tax_total_cents": priced["tax_total_cents"],
        "tip_cents": priced["tip_cents"],
        "total_cents": priced["total_cents"],
        "billable_km": 0 if fulfilment == "PICKUP" else 4,
        "route_meters": 0 if fulfilment == "PICKUP" else 3180,
        "route_source": "ROUTED",
        "expires_at": ts(9 * MINUTE + 40),
        "created_at": ts(-20),
    }
    out.update(over)
    return out


def standard_quote_lines() -> list[dict]:
    items = [menu_item(i) for i in range(3)]
    return [
        quote_line(1, items[0], 1),
        quote_line(
            2,
            items[1],
            1,
            variant=("Full", "ABSOLUTE", 1550),
            special_request="Extra gravy on the side",
        ),
        quote_line(3, items[2], 1, addons=[("Garlic naan", 2, 349)]),
    ]


def _quotes(reg) -> None:
    lines = standard_quote_lines()

    reg.add(
        "quote_standard",
        "cart",
        "Quote",
        "Three lines, 15% tip, Ontario HST at 13% on items + delivery + service. Every "
        "number is derived, so the total genuinely equals the sum of the parts.",
        _quote("standard", lines, tip_cents=700),
        operations=["createQuote", "getQuote"],
    )

    reg.add(
        "quote_zero_tip",
        "cart",
        "Quote",
        "`tip_cents: 0`. The one customer-chosen monetary input at its floor — the tip row "
        "must still render, and rider earnings must not go negative.",
        _quote("zero-tip", lines, tip_cents=0),
        operations=["createQuote", "getQuote"],
        tags=["edge", "boundary", "money"],
    )

    reg.add(
        "quote_large_tip",
        "cart",
        "Quote",
        "A CAD 100.00 tip on a CAD 60 order — larger than the subtotal. Catches tip "
        "percentage displays that assume tip < total and currency fields sized for two digits.",
        _quote("large-tip", lines, tip_cents=10000),
        operations=["createQuote", "getQuote"],
        tags=["edge", "boundary", "money"],
    )

    reg.add(
        "quote_with_discount",
        "cart",
        "Quote",
        "A restaurant-funded CAD 5.00 item discount (contradiction log #14). `funded_by` "
        "and `reimbursable` are separate fields because they answer different questions.",
        _quote(
            "discount",
            lines,
            tip_cents=700,
            discount={
                "code": "EIDMUBARAK",
                "amount_cents": 500,
                "target": "ITEMS",
                "funded_by": "RESTAURANT",
                "reimbursable": False,
            },
        ),
        operations=["createQuote", "getQuote"],
        tags=["money"],
    )

    reg.add(
        "quote_pickup",
        "cart",
        "Quote",
        "`fulfilment: PICKUP` — delivery fee is 0, there is no delivery address, and "
        "`billable_km` is 0. The delivery-fee row must disappear, not render as $0.00.",
        _quote("pickup", lines, tip_cents=300, fulfilment="PICKUP"),
        operations=["createQuote", "getQuote"],
        tags=["state-matrix"],
    )

    reg.add(
        "quote_expired",
        "cart",
        "Quote",
        "`expires_at` is 40 seconds in the past. Checking out with it is "
        "`409 QUOTE_EXPIRED`; see the `error_quote_stale` fixture for the re-quote path.",
        _quote("expired", lines, tip_cents=700, expires_at=ts(-40), created_at=ts(-10 * MINUTE)),
        operations=["getQuote"],
        tags=["edge", "error-path"],
    )

    reg.add(
        "quote_single_line_minimum",
        "cart",
        "Quote",
        "Exactly one line at the cheapest item on the menu, tip 0 — the smallest legal "
        "order. Every money row is at its minimum.",
        _quote("minimum", [quote_line(1, menu_item(12), 1)], tip_cents=0),
        operations=["createQuote"],
        tags=["edge", "boundary", "money"],
    )


def _search_and_feed(reg, synth) -> None:
    results = synth.make("SearchResults", "search")
    reg.add(
        "search_results_populated",
        "catalogue",
        "SearchResults",
        "Restaurant and dish hits for the query 'biryani'.",
        results,
        operations=["search"],
        meta=synth.make("SearchMeta", "search-meta"),
    )

    empty_results = {k: ([] if isinstance(v, list) else v) for k, v in results.items()}
    reg.add(
        "search_results_empty",
        "catalogue",
        "SearchResults",
        "No hits at all — the 'nothing matched' state, distinct from an error and from an "
        "unserved postal code.",
        empty_results,
        operations=["search"],
        meta=synth.make("SearchMeta", "search-meta-empty"),
        tags=["edge", "empty"],
    )

    reg.add(
        "feed_sections",
        "catalogue",
        "array<FeedSection>",
        "The home feed's merchandised rails.",
        [synth.make("FeedSection", f"feed-{i}") for i in range(3)],
        operations=["getHomeFeed"],
    )

    reg.add(
        "feed_empty",
        "catalogue",
        "array<FeedSection>",
        "No rails — a brand-new service area with nothing to merchandise yet.",
        [],
        operations=["getHomeFeed"],
        tags=["edge", "empty"],
    )
