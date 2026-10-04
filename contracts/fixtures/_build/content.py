"""
The realism layer: what a synthesised value *says*, as opposed to what shape it has.

Everything here is Canadian and specifically Ontarian, because Ontario is the only province
served at launch (`Province` description, decision O-05):

  * addresses on real Toronto / Mississauga / Scarborough / Brampton / Ottawa / Kitchener
    streets, with postal codes that satisfy the contract's FSA/LDU pattern;
  * `+1` numbers in the 555 reserved range, E.164 with the country code, never bare;
  * money as **integer cents**, always — there is no float anywhere in this file;
  * restaurant and dish names that a halal-food customer in the GTA would recognise.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from synth import MISS, int_for, uuid_for

# The wall clock every fixture is frozen against. Fixed so `pnpm fixtures:build` is
# reproducible and `git diff --exit-code` means something in CI.
NOW = dt.datetime(2026, 8, 10, 18, 42, 11, 412000, tzinfo=dt.timezone.utc)


def ts(offset_seconds: float = 0) -> str:
    moment = NOW + dt.timedelta(seconds=offset_seconds)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def day(offset_days: int = 0) -> str:
    return (NOW + dt.timedelta(days=offset_days)).date().isoformat()


MINUTE = 60
HOUR = 3600
DAY = 86400

# --------------------------------------------------------------------------- #
# Places
# --------------------------------------------------------------------------- #

ONTARIO_PLACES = [
    # (line1, city, postal, lat, lng)
    ("1245 Danforth Avenue", "Toronto", "M4J 1M4", 43.6817, -79.3403),
    ("3255 Hurontario Street", "Mississauga", "L5A 4E5", 43.5789, -79.6212),
    ("890 Markham Road", "Scarborough", "M1H 2Y2", 43.7699, -79.2298),
    ("55 Peel Centre Drive", "Brampton", "L6T 4G8", 43.7211, -79.7135),
    ("275 Bank Street", "Ottawa", "K2P 1X7", 45.4159, -75.6970),
    ("1500 Weber Street East", "Kitchener", "N2A 4E6", 43.4501, -80.4402),
    ("4141 Dixie Road", "Mississauga", "L4W 1V5", 43.6199, -79.6033),
    ("2350 Eglinton Avenue East", "Scarborough", "M1K 2M2", 43.7327, -79.2637),
    ("620 Wilson Avenue", "North York", "M3K 1Z3", 43.7369, -79.4530),
    ("101 Queen Street South", "Mississauga", "L5M 1K7", 43.5806, -79.7195),
    ("18 King Street East", "Hamilton", "L8N 1A1", 43.2564, -79.8690),
    ("777 Bay Street", "Toronto", "M5G 2C8", 43.6600, -79.3856),
]

RESIDENTIAL_PLACES = [
    ("88 Harbour Street", "Toronto", "M5J 0C3", 43.6412, -79.3810, "Unit 4211", "4211"),
    ("35 Fontenay Court", "Toronto", "M9A 0C7", 43.6678, -79.5289, "Unit 1802", "1802"),
    ("2 Bloor Street West", "Toronto", "M4W 3E2", 43.6700, -79.3866, None, None),
    ("4064 Confederation Parkway", "Mississauga", "L5B 0E9", 43.5896, -79.6435, "Unit 907", "907"),
    ("21 Iceboat Terrace", "Toronto", "M5V 4A8", 43.6403, -79.3958, "Unit 3305", "3305"),
    ("150 Charlton Avenue East", "Hamilton", "L8N 3X2", 43.2508, -79.8657, None, None),
]

NEIGHBOURHOODS = [
    "Greektown",
    "Cooksville",
    "Agincourt",
    "Bramalea",
    "Centretown",
    "Downtown Kitchener",
    "Malton",
    "Scarborough Junction",
    "Downsview",
    "Erin Mills",
]

# --------------------------------------------------------------------------- #
# Restaurants and dishes
# --------------------------------------------------------------------------- #

RESTAURANT_NAMES = [
    "Karachi Kitchen",
    "Al-Noor Shawarma House",
    "Bismillah Biryani House",
    "Zaytoun Mediterranean Grill",
    "Tandoori Flame",
    "Bosphorus Turkish Kebab",
    "Barakah Charcoal Grill",
    "Lahore Tikka Corner",
    "Damascus Sweets & Grill",
    "Sultan's Table",
    "Halal Munchies Scarborough",
    "Marhaba Fried Chicken",
]

# The overflow case the design system's truncation rules exist for.
LONG_RESTAURANT_NAME = (
    "The Original Charcoal-Grilled Chicken Shawarma & Mediterranean Family "
    "Restaurant of Mississauga (Hurontario at Dundas)"
)
LONG_DISH_NAME = (
    "Slow-Cooked Bone-In Lamb Nihari with Saffron Basmati, House Naan, "
    "Pickled Onion Salad and Two Chutneys (Family Size, Serves Four to Six)"
)

CUISINES = [
    ["Pakistani", "Biryani", "Halal"],
    ["Middle Eastern", "Shawarma", "Halal"],
    ["Indian", "Biryani", "Halal"],
    ["Mediterranean", "Grill", "Halal"],
    ["Indian", "Tandoori", "Halal"],
    ["Turkish", "Kebab", "Halal"],
]

DISHES = [
    # (name, description, price_cents, prep_minutes, dietary, allergens)
    ("Chicken Biryani", "Long-grain basmati layered with bone-in chicken, fried onion and kewra.", 1695, 22, ["HALAL_CERTIFIED"], ["MILK"]),
    ("Beef Nihari", "Overnight-simmered beef shank in a bone-marrow gravy. Served with two naan.", 2145, 18, ["HALAL_CERTIFIED", "SPICY"], ["WHEAT_TRITICALE"]),
    ("Chicken Karahi (Half)", "Wok-finished with tomato, ginger julienne and green chilli.", 1899, 20, ["HALAL_CERTIFIED", "SPICY", "GLUTEN_FREE"], ["MILK"]),
    ("Lamb Shawarma Platter", "Shaved lamb, garlic toum, pickled turnip, rice and salad.", 1849, 12, ["HALAL_CERTIFIED"], ["SESAME", "MILK"]),
    ("Falafel Wrap", "Chickpea falafel, tahini, tomato, parsley in a saj wrap.", 1099, 8, ["VEGETARIAN", "VEGAN", "HALAL_CERTIFIED"], ["SESAME", "WHEAT_TRITICALE"]),
    ("Butter Chicken", "Tandoori chicken thigh in tomato and fenugreek cream.", 1795, 16, ["HALAL_CERTIFIED"], ["MILK", "TREE_NUTS"]),
    ("Seekh Kebab (4 pc)", "Hand-minced beef, charcoal grilled, with mint chutney.", 1395, 14, ["HALAL_CERTIFIED", "GLUTEN_FREE"], []),
    ("Chapli Kebab", "Peshawari-style flat kebab with coriander seed and pomegranate.", 1495, 15, ["HALAL_CERTIFIED", "SPICY"], ["EGGS", "WHEAT_TRITICALE"]),
    ("Haleem", "Seven-lentil and shredded beef porridge, finished with crisp onion.", 1299, 10, ["HALAL_CERTIFIED"], ["WHEAT_TRITICALE"]),
    ("Adana Kebab", "Hand-minced lamb on a wide skewer with sumac onion.", 2099, 18, ["HALAL_CERTIFIED", "SPICY"], []),
    ("Lahmacun (2 pc)", "Thin Turkish flatbread with spiced minced lamb and parsley.", 1250, 12, ["HALAL_CERTIFIED"], ["WHEAT_TRITICALE"]),
    ("Chicken Shawarma Poutine", "Fries, cheese curds, shawarma gravy and garlic sauce.", 1599, 11, ["HALAL_CERTIFIED"], ["MILK", "WHEAT_TRITICALE"]),
    ("Mango Lassi", "Alphonso pulp, yoghurt, a pinch of cardamom.", 549, 3, ["VEGETARIAN", "HALAL_CERTIFIED"], ["MILK"]),
    ("Baklava (3 pc)", "Pistachio and walnut, honey syrup, made in-house every morning.", 799, 2, ["VEGETARIAN", "HALAL_CERTIFIED"], ["TREE_NUTS", "WHEAT_TRITICALE", "MILK"]),
    ("Kunefe", "Shredded pastry over stretchy cheese, orange-blossom syrup.", 999, 9, ["VEGETARIAN", "HALAL_CERTIFIED"], ["MILK", "WHEAT_TRITICALE", "TREE_NUTS"]),
]

CATEGORY_NAMES = ["Biryani & Rice", "From the Charcoal Grill", "Curries", "Wraps & Sandwiches", "Sides", "Desserts", "Drinks"]

FIRST_NAMES = ["Ayesha", "Bilal", "Fatima", "Hamza", "Imran", "Khadija", "Omar", "Rania", "Sana", "Yusuf", "Zainab", "Tariq"]
LAST_NAMES = ["Rahman", "Siddiqui", "Khan", "Haddad", "Ibrahim", "Cheema", "Nasser", "Farooq", "Ali", "Osman"]

ISSUING_BODIES = [
    "Halal Monitoring Authority (HMA Canada)",
    "Islamic Food and Nutrition Council of Canada",
    "Canadian Halal Certification Bureau",
    "Halal Advisory Council of Ontario",
]

IMAGE_BASE = "https://cdn.halalgoes.ca/img"


class Content:
    """Name-keyed realism. `ctx` lets a scenario builder pin values (a restaurant name, a
    timestamp offset) so every synthesised child stays coherent with its parent."""

    def __init__(self) -> None:
        self.ctx: dict[str, Any] = {}

    # ---------------------------------------------------------- named types --

    def by_schema(self, name: str, label: str, prop: str | None) -> Any:
        if name == "Cents":
            return self.cents(prop, label)
        if name == "Currency":
            return "CAD"
        if name == "Timestamp":
            return self.timestamp(prop, label)
        if name == "Ulid":
            from synth import ulid_for

            return ulid_for(label)
        if name == "PhoneE164":
            return self.phone(label)
        if name == "PostalCode":
            return self.postal_code(label)
        if name == "Timezone":
            return "America/Toronto"
        if name == "Latitude":
            return self.latitude(label)
        if name == "Longitude":
            return self.longitude(label)
        if name == "Password":
            return "correct-horse-battery-staple-7"
        if name == "Cursor":
            from synth import ulid_for

            return ulid_for(label)
        if name == "Province":
            return "ON"
        return MISS

    # --------------------------------------------------------------- scalars --

    def cents(self, prop: str | None, label: str) -> int:
        pinned = self.ctx.get("cents", {}).get(prop)
        if pinned is not None:
            return pinned
        if prop is None:
            return 1695
        table = {
            "subtotal_cents": 4634,
            "discount_cents": 0,
            "discount_items_cents": 0,
            "discount_delivery_cents": 0,
            "discount_service_cents": 0,
            "delivery_fee_cents": 449,
            "service_fee_cents": 232,
            "tax_total_cents": 691,
            "tip_cents": 700,
            "total_cents": 6706,
            "amount_cents": 6706,
            "base_cents": 4634,
            "unit_price_cents": 1695,
            "line_total_cents": 1695,
            "price_cents": 1695,
            "addon_price_cents": 199,
            "current_price_cents": 1795,
            "minimum_order_cents": 1500,
            "indicative_delivery_fee_cents": 449,
            "indicative_subtotal_cents": 4634,
            "estimated_total_cents": 1149,
            "distance_cents": 0,
            "surge_cents": 0,
            "tip_so_far_cents": 700,
            "commission_cents": 0,
            "restaurant_net_cents": 4634,
            "rider_earnings_cents": 1149,
            "platform_gross_cents": 232,
            "ledger_residual_cents": 0,
            "amount_authorized_cents": 6706,
            "amount_captured_cents": 6706,
            "amount_refunded_cents": 0,
            "amount_charged_cents": 6706,
            "platform_cents": 0,
            "restaurant_cents": 0,
            "rider_cents": 0,
            "tax_cents": 0,
            "proposed_amount_cents": 1695,
            "line_unit_cents": 1695,
            "variant_part_cents": 0,
            "addons_part_cents": 0,
            "base_price_cents": 1695,
            "delta_cents": 300,
            "guarantee_topup_cents": 0,
            "wait_cents": 0,
            "gross_cents": 1149,
            "net_cents": 1149,
            "earnings_cents": 1149,
            "expected_cents": 6706,
            "actual_cents": 6706,
            "new_total_cents": 6706,
        }
        return table.get(prop, 1695)

    def timestamp(self, prop: str | None, label: str) -> str:
        pinned = self.ctx.get("ts", {}).get(prop)
        if pinned is not None:
            return pinned
        table = {
            "created_at": ts(-45 * MINUTE),
            "placed_at": ts(-32 * MINUTE),
            "requested_at": ts(-20 * MINUTE),
            "issued_at": ts(-5 * MINUTE),
            "accepted_at": ts(-29 * MINUTE),
            "ready_at": ts(-14 * MINUTE),
            "picked_up_at": ts(-11 * MINUTE),
            "delivered_at": ts(-2 * MINUTE),
            "completed_at": ts(-1 * MINUTE),
            "settled_at": ts(-1 * MINUTE),
            "captured_at": ts(-2 * MINUTE),
            "authorized_at": ts(-31 * MINUTE),
            "verified_at": ts(-30 * DAY),
            "reviewed_at": ts(-30 * DAY),
            "assigned_at": ts(-16 * MINUTE),
            "arrived_pickup_at": ts(-12 * MINUTE),
            "arrived_dropoff_at": ts(-3 * MINUTE),
            "recorded_at": ts(-8),
            "server_time": ts(0),
            "at": ts(-6 * MINUTE),
            "expires_at": ts(9 * MINUTE),
            "deadline_at": ts(2 * MINUTE + 20),
            "eta_at": ts(13 * MINUTE),
            "pickup_eta_at": ts(6 * MINUTE),
            "dropoff_eta_at": ts(13 * MINUTE),
            "promised_ready_at": ts(9 * MINUTE),
            "opens_at": ts(-6 * HOUR),
            "closes_at": ts(4 * HOUR),
            "out_of_stock_until": ts(4 * HOUR),
            "updated_at": ts(-3 * MINUTE),
            "last_seen_at": ts(-25),
            "submitted_at": ts(-6 * DAY),
            "decided_at": ts(-2 * DAY),
            "read_at": ts(-40 * MINUTE),
            "deadline": ts(7 * DAY),
            "start": ts(-7 * DAY),
            "end": ts(0),
            "period_start": ts(-7 * DAY),
            "period_end": ts(0),
            "paid_at": ts(-1 * DAY),
            "revoked_at": ts(-1 * DAY),
        }
        return table.get(prop or "", ts(-10 * MINUTE))

    def date(self, prop: str | None, label: str) -> str:
        pinned = self.ctx.get("date", {}).get(prop)
        if pinned is not None:
            return pinned
        table = {
            "issued_on": day(-300),
            "expires_on": day(210),
            "date_of_birth": "1994-03-17",
            "date": day(3),
            "expiry_date": day(400),
        }
        return table.get(prop or "", day(0))

    def phone(self, label: str) -> str:
        return f"+1416555{int_for(label, 100, 999)}{int_for(label + 'x', 0, 9)}"

    def postal_code(self, label: str) -> str:
        return ONTARIO_PLACES[int_for(label, 0, len(ONTARIO_PLACES) - 1)][2]

    def latitude(self, label: str) -> float:
        pinned = self.ctx.get("lat")
        if pinned is not None:
            return pinned
        return ONTARIO_PLACES[int_for(label, 0, len(ONTARIO_PLACES) - 1)][3]

    def longitude(self, label: str) -> float:
        pinned = self.ctx.get("lng")
        if pinned is not None:
            return pinned
        return ONTARIO_PLACES[int_for(label, 0, len(ONTARIO_PLACES) - 1)][4]

    def email(self, prop: str | None, label: str) -> str:
        return "owner@karachikitchen.ca"

    def image_url(self, prop: str | None, label: str) -> str:
        kind = {
            "hero_image_url": "restaurant/hero",
            "logo_image_url": "restaurant/logo",
            "image_url": "dish",
            "photo_url": "avatar",
            "receipt_url": "receipt",
            "download_url": "doc",
            "upload_url": "upload",
        }.get(prop or "", "asset")
        if prop in ("upload_url",):
            return f"https://uploads.halalgoes.ca/{kind}/{uuid_for(label)}?signature=stub"
        if prop == "receipt_url":
            return f"https://halalgoes.ca/receipts/{uuid_for(label)}.pdf"
        if prop == "deep_link":
            return f"halalgoes://orders/{uuid_for(label)}"
        return f"{IMAGE_BASE}/{kind}/{uuid_for(label)[:8]}.webp"

    # --------------------------------------------------------------- strings --

    def generic_string(self, prop: str | None, label: str) -> Any:
        if prop is None:
            return "sample"
        pinned = self.ctx.get("str", {}).get(prop)
        if pinned is not None:
            return pinned
        n = int_for(label, 0, 11)
        place = ONTARIO_PLACES[n % len(ONTARIO_PLACES)]
        res = ONTARIO_PLACES[n % len(ONTARIO_PLACES)]
        first = FIRST_NAMES[n % len(FIRST_NAMES)]
        last = LAST_NAMES[n % len(LAST_NAMES)]
        table: dict[str, Any] = {
            "name": RESTAURANT_NAMES[n % len(RESTAURANT_NAMES)],
            "restaurant_name": RESTAURANT_NAMES[n % len(RESTAURANT_NAMES)],
            "legal_name": RESTAURANT_NAMES[n % len(RESTAURANT_NAMES)] + " Inc.",
            "certified_legal_name": RESTAURANT_NAMES[n % len(RESTAURANT_NAMES)] + " Inc.",
            "display_name": f"{first} {last[0]}.",
            "customer_display_name": f"{first} {last[0]}.",
            "first_name": first,
            "last_name": last,
            "last_initial": last[0],
            "slug": RESTAURANT_NAMES[n % len(RESTAURANT_NAMES)].lower().replace(" ", "-").replace("'", "").replace("&", "and"),
            "description": "Charcoal-grilled, hand-cut and cooked to order. Halal certified.",
            "line1": place[0],
            "line2": None,
            "unit": "Unit 12",
            "buzzer": "1204",
            "city": place[1],
            "label": "Home",
            "address": f"{place[0]}, {place[1]}, ON",
            "address_short": f"{place[0]}, {place[1]}",
            "certified_address": f"{place[0]}, {place[1]}, ON {place[2]}",
            "delivery_area": NEIGHBOURHOODS[n % len(NEIGHBOURHOODS)],
            "area": NEIGHBOURHOODS[n % len(NEIGHBOURHOODS)],
            "neighbourhood": NEIGHBOURHOODS[n % len(NEIGHBOURHOODS)],
            "delivery_notes": "Buzz 1204. Please leave at the door, do not knock — baby sleeping.",
            "special_instructions": "Extra napkins please, and no cutlery.",
            "special_request": "No onions",
            "pickup_notes": "Collect from the hot counter on the left, ask for the app order.",
            "note": "Customer called to confirm the buzzer code.",
            "text": "Customer called to confirm the buzzer code.",
            "message": "The quote you are checking out with is no longer current.",
            "reason": "Closed for a scheduled deep clean. Reopening at 14:00.",
            "reason_text": "Certificate scan is legible but the trading name does not match the registration.",
            "rejection_reason_text": "The uploaded page is cropped — the expiry date is not visible.",
            "phone_masked": "+1 416 ••• 0142",
            "phone_alias": "+16475550188",
            "public_phone_e164": "+14165550142",
            "certificate_number": f"HMA-ON-{int_for(label, 10000, 99999)}",
            "certifying_body_name": ISSUING_BODIES[n % len(ISSUING_BODIES)],
            "issuing_body_name": ISSUING_BODIES[n % len(ISSUING_BODIES)],
            "jurisdiction_code": "CA-ON",
            "statutory_label": "HST",
            "rate": "0.13",
            "brand": "visa",
            "card_brand": "visa",
            "last4": "4242",
            "card_last4": "4242",
            "wallet": None,
            "client_secret": f"pi_3Qk{uuid_for(label)[:14].replace('-', '')}_secret_5cGvA9pQ",
            "code": "HG-4K2M-9T",
            "order_code": "HG-4K2M-9T",
            "receipt_number": "HG-2026-000148213",
            "request_id": None,
            "checksum": "sha256:9f2b1c4e8a7d6053f1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f801",
            "content_type": "image/jpeg",
            "title": "Your order is on the way",
            "body": "Bilal picked up your order from Karachi Kitchen.",
            "kind": "ORDER_PICKED_UP",
            "deep_link": f"halalgoes://orders/{uuid_for(label)}",
            "ip_city": "Toronto, ON",
            "user_agent": "HalalGoes/1.4.0 (iPhone; iOS 18.2)",
            "device_name": "Ayesha's iPhone",
            "model": "iPhone 15",
            "os_version": "18.2",
            "app_version": "1.4.0",
            "push_token": "f3c2a1d0e9b8a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2",
            "plate": "CJHK 812",
            "make": "Toyota",
            "vehicle_make": "Toyota",
            "vehicle_model": "Corolla",
            "colour": "Silver",
            "licence_number": "R1234-56789-01234",
            "gst_hst_number": "812345678RT0001",
            "tax_registration_number": "812345678RT0001",
            "platform_tax_registration_number": "701234567RT0001",
            "restaurant_tax_registration_number": "812345678RT0001",
            "platform_legal_name": "HalalGoes Technologies Inc.",
            "restaurant_legal_name": RESTAURANT_NAMES[n % len(RESTAURANT_NAMES)] + " Inc.",
            "ingredients_text": "Chicken, basmati rice, yoghurt, fried onion, tomato, ginger, garlic, garam masala, saffron, kewra water, ghee.",
            "menu_item_name": DISHES[n % len(DISHES)][0],
            "addon_name": "Garlic Toum",
            "variant_name": "Regular",
            "out_of_range_reason": None,
            "failure_message": None,
            "failure_code": None,
            "decline_code": None,
            "severity": "WARNING",
            "subject_type": "ORDER",
            "next_action": None,
            "version": "2026-05-01",
            "terms_version": "2026-05-01",
            "policy_version": "2026-05-01",
            "url": "https://halalgoes.ca/legal/terms-2026-05-01",
            "support_email": "support@halalgoes.ca",
            "support_phone_e164": "+18005550199",
            "min_supported_version": "1.2.0",
            "latest_version": "1.4.0",
            "commit": "7ed4381",
            "build": "2026.08.10-1",
            "environment": "mock",
            "region": "ca-central-1",
        }
        if prop in table:
            return table[prop]
        return prop.replace("_", " ").title()

    def string(self, prop: str | None, schema: dict, label: str) -> Any:
        value = self.generic_string(prop, label)
        if value is None or not isinstance(value, str):
            return MISS if value is None else value
        return value

    # -------------------------------------------------------------- numerics --

    def integer(self, prop: str | None, schema: dict, label: str) -> Any:
        pinned = self.ctx.get("int", {}).get(prop)
        if pinned is not None:
            return pinned
        table = {
            "quantity": 1,
            "addon_quantity": 1,
            "item_count": 3,
            "items_count": 3,
            "line_no": 1,
            "sort_order": 1,
            "rating_count": 412,
            "checklist_version": 1,
            "prep_minutes": 18,
            "prep_eta_minutes": 20,
            "prep_eta_suggestion_min": 20,
            "eta_min_minutes": 25,
            "eta_max_minutes": 40,
            "eta_window_minutes": 10,
            "distance_m": 3180,
            "billable_distance_m": 3180,
            "route_meters": 3180,
            "billable_km": 4,
            "radius_m": 6000,
            "est_duration_s": 660,
            "pickup_wait_seconds": 240,
            "elapsed_seconds": 1920,
            "exp_month": 11,
            "exp_year": 2029,
            "day_of_week": 3,
            "wave": 2,
            "waves": 3,
            "riders_offered": 8,
            "deliveries": 14,
            "seq": 1487,
            "limit": 20,
            "commission_rate_bps": 0,
            "restaurant_response_window_seconds": 180,
            "attempts_remaining": 4,
            "resend_after_s": 45,
            "progress_percent": 60,
            "steps_completed": 3,
            "steps_total": 5,
            "heartbeat_s": 25,
            "protocol": 1,
            "accuracy_m": 12,
            "min_select": 0,
            "max_select": 3,
            "cart_line_quantity_max": 20,
            "max_active_orders": 1,
            "size_bytes": 184320,
            "width": 1600,
            "height": 1200,
            "replayed": 0,
            "pending_restaurant_reviews": 4,
            "pending_rider_reviews": 9,
            "open_disputes": 2,
            "failed_refunds": 0,
            "total": 3,
        }
        if prop in table:
            return table[prop]
        return MISS

    def number(self, prop: str | None, schema: dict, label: str) -> Any:
        pinned = self.ctx.get("num", {}).get(prop)
        if pinned is not None:
            return pinned
        table = {
            "rating_avg": 4.6,
            "rating": 4.6,
            "heading_deg": 118.0,
            "speed_mps": 7.4,
            "accuracy_m": 12.0,
        }
        if prop in table:
            return table[prop]
        return MISS

    def boolean(self, prop: str | None, label: str) -> bool:
        pinned = self.ctx.get("bool", {}).get(prop)
        if pinned is not None:
            return pinned
        false_by_default = {
            "is_closed",
            "crosses_midnight",
            "rebate_applied",
            "reimbursable",
            "truncated",
            "pii_revealed",
            "pod_recorded",
            "is_coarse",
            "retryable",
            "has_more",
            "is_deleted",
            "requires_action",
            "is_late",
            "mfa_enabled",
            "totp_enabled",
            "is_online",
            "email_verified",
            "suspended",
            "auto_approved",
        }
        if prop in false_by_default:
            return False
        return True

    # ---------------------------------------------------------------- shapes --

    def array_size(self, prop: str | None, schema: dict, label: str) -> int:
        pinned = self.ctx.get("arr", {}).get(prop)
        if pinned is not None:
            return pinned
        max_items = schema.get("maxItems")
        min_items = schema.get("minItems", 0)
        default = {
            "lines": 3,
            "items": 3,
            "categories": 3,
            "tax_lines": 1,
            "roles": 1,
            "checks": 7,
            "dietary_tags": 2,
            "allergen_tags": 2,
            "cuisines": 3,
            "delivery_instructions": 1,
            "addons": 1,
            "addon_names": 1,
            "variants": 2,
            "variant_groups": 1,
            "addon_groups": 1,
            "intervals": 7,
            "overrides": 1,
            "timeline": 4,
            "dispatch_history": 3,
            "refunds": 0,
            "ledger_entries": 4,
            "documents": 4,
            "currently_due": 0,
            "past_due": 0,
            "allowed_channels": 3,
            "blocking_reasons": 0,
            "details": 1,
            "first_item_names": 2,
            "sections": 3,
            "results": 3,
            "served_provinces": 1,
            "entries": 3,
            "buckets": 7,
        }.get(prop or "", 2)
        if max_items is not None:
            default = min(default, max_items)
        return max(default, min_items)

    def enum_choice(self, schema_name: str | None, prop: str | None, members: list, label: str) -> Any:
        pinned = self.ctx.get("enum", {}).get(prop)
        if pinned is not None:
            return pinned
        by_schema = {
            "Currency": "CAD",
            "Province": "ON",
            "OrderState": "PREPARING",
            "DispatchState": "ASSIGNED",
            "AssignmentState": "EN_ROUTE_TO_DROPOFF",
            "HalalDisplayState": "CERTIFIED",
            "HalalCertificateStatus": "APPROVED",
            "HalalCheckResult": "PASS",
            "PaymentState": "SUCCEEDED",
            "RefundState": "SETTLED",
            "RefundKind": "PARTIAL_ITEMS",
            "RefundReasonCode": "ITEM_MISSING",
            "Fulfilment": "DELIVERY",
            "Role": "CUSTOMER",
            "TaxKind": "HST",
            "TaxCategory": "PREPARED_FOOD",
            "RemittableBy": "RESTAURANT",
            "MenuItemAvailabilityState": "AVAILABLE",
            "MenuReviewStatus": "APPROVED",
            "VariantPricingMode": "ABSOLUTE",
            "DeliveryInstruction": "LEAVE_AT_DOOR",
            "PodMethod": "PHOTO",
            "HandoverMethod": "LEFT_AT_DOOR",
            "VehicleType": "CAR",
            "RestaurantOpenState": "OPEN",
            "RestaurantAvailabilityState": "OPEN",
            "RestaurantAccountState": "LIVE",
            "RestaurantOnboardingState": "ACTIVE",
            "RiderOnboardingState": "ACTIVE",
            "RiderAccountStatus": "ACTIVE",
            "RiderAvailabilityState": "ONLINE_IDLE",
            "AccountStatus": "ACTIVE",
            "KycDocumentState": "APPROVED",
            "StoredObjectState": "READY",
            "PayoutState": "PAID",
            "PayoutInterval": "WEEKLY",
            "EarningEntryType": "DELIVERY",
            "EarningEntryStatus": "AVAILABLE",
            "EarningsPeriod": "WEEK",
            "OrderActorKind": "SYSTEM",
            "RouteSource": "ROUTED",
            "TrackingHealth": "HEALTHY",
            "PriceBand": "$$",
            "RestaurantSort": "RECOMMENDED",
            "NotificationChannel": "PUSH",
            "NotificationPriority": "NORMAL",
            "DevicePlatform": "ios",
            "StaffStatus": "ACTIVE",
            "ClientSurface": "customer-app",
            "AuthMethod": "otp",
            "NextRoute": "HOME",
            "OfferState": "PENDING",
            "DispatchOfferOutcome": "ACCEPTED",
            "HalalCertificateScope": "WHOLE_ESTABLISHMENT",
            "HalalIssuingBodyStatus": "ACCEPTED",
            "DiscountTarget": "ITEMS",
            "DiscountFundedBy": "RESTAURANT",
            "LedgerAccount": "RESTAURANT_PAYABLE",
            "LedgerComponent": "SUBTOTAL",
            "ErrorCode": "VALIDATION_FAILED",
            "PaymentIntentKind": "ORDER",
            "OrderStatusGroup": "ACTIVE",
            "RefundScope": "PARTIAL_ITEMS",
            "RestaurantDocType": "BUSINESS_LICENCE",
            "RiderDocType": "DRIVERS_LICENCE",
            "StoredObjectPurpose": "KYC_DOCUMENT",
            "HealthStatus": "ok",
        }
        if schema_name in by_schema and by_schema[schema_name] in members:
            return by_schema[schema_name]
        by_prop = {"country": "CA", "payment_status": "PREPAID", "status": members[0]}
        if prop in by_prop and by_prop[prop] in members:
            return by_prop[prop]
        return members[0]
