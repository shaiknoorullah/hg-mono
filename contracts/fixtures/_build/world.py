"""
The canonical world every fixture shares.

Ids are derived from stable labels (`uuid_for("restaurant:karachi-kitchen")`), so the
restaurant id inside `order_preparing` is byte-identical to the id in
`restaurant_detail_certified`. Four app agents can therefore cross-reference fixtures
without a seeded database.
"""

from __future__ import annotations

from typing import Any

from content import (
    DISHES,
    LONG_DISH_NAME,
    LONG_RESTAURANT_NAME,
    NEIGHBOURHOODS,
    ONTARIO_PLACES,
    RESIDENTIAL_PLACES,
    RESTAURANT_NAMES,
    CATEGORY_NAMES,
    CUISINES,
    ISSUING_BODIES,
    IMAGE_BASE,
    DAY,
    HOUR,
    MINUTE,
    day,
    ts,
)
from synth import uuid_for

HST_RATE = "0.13"


def slug(name: str) -> str:
    out = name.lower().replace("'", "").replace("&", "and")
    out = "".join(ch if ch.isalnum() else "-" for ch in out)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")[:60]


# --------------------------------------------------------------------------- #
# Addresses
# --------------------------------------------------------------------------- #


def address(label: str, index: int = 0, *, is_default: bool = True, **over: Any) -> dict:
    line1, city, postal, lat, lng, unit, buzzer = RESIDENTIAL_PLACES[index % len(RESIDENTIAL_PLACES)]
    out = {
        "id": uuid_for(f"address:{label}"),
        "label": ["Home", "Work", "Mum's place"][index % 3],
        "line1": line1,
        "line2": None,
        "unit": unit,
        "buzzer": buzzer,
        "city": city,
        "province": "ON",
        "postal_code": postal,
        "country": "CA",
        "latitude": lat,
        "longitude": lng,
        "timezone": "America/Toronto",
        "delivery_notes": "Buzz the unit, then leave it at the door. Please don't knock.",
        "is_default": is_default,
    }
    out.update(over)
    return out


def public_address(index: int = 0, **over: Any) -> dict:
    line1, city, postal, lat, lng = ONTARIO_PLACES[index % len(ONTARIO_PLACES)]
    out = {
        "line1": line1,
        "line2": None,
        "city": city,
        "province": "ON",
        "postal_code": postal,
        "latitude": lat,
        "longitude": lng,
    }
    out.update(over)
    return out


# --------------------------------------------------------------------------- #
# Halal
# --------------------------------------------------------------------------- #


def halal_badge(state: str = "CERTIFIED", **over: Any) -> dict:
    expiry = {
        "CERTIFIED": day(211),
        "EXPIRING_SOON": day(18),
        "EXPIRED": day(-9),
        "UNVERIFIED": None,
    }[state]
    out = {
        "display_state": state,
        "certifying_body_name": None if state == "UNVERIFIED" else ISSUING_BODIES[0],
        "expires_on": expiry,
    }
    out.update(over)
    return out


def trading_hours() -> list[dict]:
    """Mon–Thu 11:00–22:00, Fri–Sat 11:00–01:00 (crosses midnight), Sun 12:00–21:00."""
    out = []
    for dow in range(7):
        if dow == 0:
            opens, closes, crosses = "12:00", "21:00", False
        elif dow in (5, 6):
            opens, closes, crosses = "11:00", "01:00", True
        else:
            opens, closes, crosses = "11:00", "22:00", False
        out.append(
            {
                "day_of_week": dow,
                "opens_at": opens,
                "closes_at": closes,
                "crosses_midnight": crosses,
            }
        )
    return out


# --------------------------------------------------------------------------- #
# Restaurants
# --------------------------------------------------------------------------- #


def availability(state: str = "OPEN", **over: Any) -> dict:
    out = {
        "state": state,
        "opens_at": ts(-7 * HOUR + 42 * MINUTE),
        "closes_at": ts(3 * HOUR + 18 * MINUTE),
        "eta_min_minutes": 25,
        "eta_max_minutes": 40,
        "indicative_delivery_fee_cents": 449,
        "minimum_order_cents": 1500,
        "distance_m": 3180,
        "out_of_range_reason": None,
    }
    if state == "CLOSED_HOURS":
        out.update(
            {
                "opens_at": ts(15 * HOUR),
                "closes_at": None,
                "eta_min_minutes": None,
                "eta_max_minutes": None,
            }
        )
    elif state == "PAUSED":
        out.update({"eta_min_minutes": None, "eta_max_minutes": None})
    elif state == "OUT_OF_RANGE":
        out.update(
            {
                "eta_min_minutes": None,
                "eta_max_minutes": None,
                "indicative_delivery_fee_cents": None,
                "distance_m": 21400,
                "out_of_range_reason": "This kitchen delivers within 12 km. You are 21.4 km away.",
            }
        )
    elif state == "NO_ADDRESS":
        out.update(
            {
                "opens_at": None,
                "closes_at": None,
                "eta_min_minutes": None,
                "eta_max_minutes": None,
                "indicative_delivery_fee_cents": None,
                "distance_m": None,
                "out_of_range_reason": None,
            }
        )
    out.update(over)
    return out


def restaurant_card(index: int = 0, *, halal_state: str = "CERTIFIED", **over: Any) -> dict:
    name = RESTAURANT_NAMES[index % len(RESTAURANT_NAMES)]
    key = slug(name)
    out = {
        "id": uuid_for(f"restaurant:{key}"),
        "name": name,
        "slug": key,
        "hero_image_url": f"{IMAGE_BASE}/restaurant/hero/{key}.webp",
        "logo_image_url": f"{IMAGE_BASE}/restaurant/logo/{key}.webp",
        "cuisines": CUISINES[index % len(CUISINES)],
        "rating_avg": [4.8, 4.6, 4.4, 4.9, 4.2, 4.7][index % 6],
        "rating_count": [412, 1183, 96, 2741, 38, 604][index % 6],
        "price_band": ["$$", "$", "$$", "$$$", "$$", "$"][index % 6],
        "halal": halal_badge(halal_state),
        "availability": availability("OPEN", distance_m=1200 + index * 940),
    }
    out.update(over)
    return out


def certification_panel(state: str = "CERTIFIED", **over: Any) -> dict:
    known = state != "UNVERIFIED"
    out = {
        "display_state": state,
        "certifying_body_name": ISSUING_BODIES[0] if known else None,
        "certificate_number": "HMA-ON-40182" if known else None,
        "scope": "WHOLE_ESTABLISHMENT" if known else None,
        "issued_on": day(-154) if known else None,
        "expires_on": halal_badge(state)["expires_on"],
        "verified_at": ts(-152 * DAY) if known else None,
        "certificate_viewable": known,
        # C-12: fixed copy. Halal Goes verifies certification; it does not certify food.
        "disclaimer": (
            "Certification verified by Halal Goes on 9 March 2026. "
            "Halal Goes does not itself certify food."
            if known
            else "This kitchen has not provided a halal certificate we can verify. "
            "Halal Goes does not itself certify food."
        ),
    }
    out.update(over)
    return out


def restaurant_detail(index: int = 0, *, halal_state: str = "CERTIFIED", **over: Any) -> dict:
    card = restaurant_card(index, halal_state=halal_state)
    out = dict(card)
    out.update(
        {
            "description": (
                "A Danforth institution since 2011. Charcoal grill, hand-pounded masala, "
                "and a kitchen that has been HMA-certified every year we have traded."
            ),
            "address": public_address(index),
            "timezone": "America/Toronto",
            "public_phone_e164": "+14165550142",
            "certification": certification_panel(halal_state),
            "hours": trading_hours(),
        }
    )
    out.update(over)
    return out


# --------------------------------------------------------------------------- #
# Menu
# --------------------------------------------------------------------------- #


def menu_item(index: int = 0, *, restaurant_key: str = "karachi-kitchen", **over: Any) -> dict:
    name, description, price, prep, dietary, allergens = DISHES[index % len(DISHES)]
    key = f"{restaurant_key}:{slug(name)}"
    out = {
        "id": uuid_for(f"item:{key}"),
        "name": name,
        "description": description,
        "image_url": f"{IMAGE_BASE}/dish/{slug(name)}.webp",
        "price_cents": price,
        "currency": "CAD",
        "availability_state": "AVAILABLE",
        "out_of_stock_until": None,
        "dietary_tags": dietary,
        "allergen_tags": allergens,
        "ingredients_text": (
            "Chicken, basmati rice, yoghurt, fried onion, tomato, ginger, garlic, "
            "garam masala, saffron, kewra water, ghee."
        ),
        "tax_category": "PREPARED_FOOD",
        "prep_minutes": prep,
        "variant_groups": [],
        "addon_groups": [],
    }
    out.update(over)
    return out


def variant_group(label: str, name: str, variants: list[tuple[str, str, int | None, int | None, bool, bool]], *, required: bool = True) -> dict:
    return {
        "id": uuid_for(f"vgroup:{label}"),
        "name": name,
        "required": required,
        "variants": [
            {
                "id": uuid_for(f"variant:{label}:{slug(vname)}"),
                "name": vname,
                "pricing_mode": mode,
                "price_cents": price,
                "delta_cents": delta,
                "is_default": is_default,
                "is_available": is_available,
            }
            for (vname, mode, price, delta, is_default, is_available) in variants
        ],
    }


def addon_group(label: str, name: str, addons: list[tuple[str, int, bool]], *, min_select: int = 0, max_select: int = 3) -> dict:
    return {
        "id": uuid_for(f"agroup:{label}"),
        "name": name,
        "min_select": min_select,
        "max_select": max_select,
        "addons": [
            {
                "id": uuid_for(f"addon:{label}:{slug(aname)}"),
                "name": aname,
                "price_cents": price,
                "is_available": available,
            }
            for (aname, price, available) in addons
        ],
    }


def menu_category(index: int, items: list[dict], **over: Any) -> dict:
    name = CATEGORY_NAMES[index % len(CATEGORY_NAMES)]
    out = {
        "id": uuid_for(f"category:{slug(name)}"),
        "name": name,
        "description": None,
        "sort_order": index + 1,
        "is_active": True,
        "item_count": len(items),
        "items": items,
    }
    out.update(over)
    return out


# --------------------------------------------------------------------------- #
# People
# --------------------------------------------------------------------------- #


def rider_public_profile(**over: Any) -> dict:
    out = {
        "first_name": "Bilal",
        "last_initial": "S",
        "photo_url": f"{IMAGE_BASE}/avatar/rider-bilal.webp",
        "vehicle_type": "SCOOTER",
        "rating_avg": 4.9,
    }
    out.update(over)
    return out


def order_restaurant_ref(index: int = 0, *, halal_state: str = "CERTIFIED", **over: Any) -> dict:
    card = restaurant_card(index, halal_state=halal_state)
    out = {
        "id": card["id"],
        "name": card["name"],
        "logo_image_url": card["logo_image_url"],
        "halal": card["halal"],
    }
    out.update(over)
    return out
