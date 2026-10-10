"""
Address search: suggestions, the address of a picked suggestion, and the address under a
map pin (`suggestAddresses`, `getPlaceAddress`, `reverseGeocode`).

Our API forwards these to Mapbox (the owner's round-2 decision of 2026-10-01, map address
search: docs/decisions/README.md, "Launch scope and contract"; issue #179). The error
states, no match and provider unavailable, are in `dom_errors.py` under `GEO_ERRORS`.
"""

from __future__ import annotations

import base64


def place_id(label: str) -> str:
    """An opaque, URL-safe handle, stable per label. Clients never build or parse one."""
    raw = f"urn:hg:place:{label}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _suggestion(label, kind, title, subtitle, distance_m):
    return {
        "place_id": place_id(label),
        "kind": kind,
        "title": title,
        "subtitle": subtitle,
        "distance_m": distance_m,
    }


def _address(kind, line1, city, province, postal, lat, lng, formatted, name=None):
    return {
        "kind": kind,
        "name": name,
        "line1": line1,
        "city": city,
        "province": province,
        "postal_code": postal,
        "country": "CA",
        "latitude": lat,
        "longitude": lng,
        "formatted": formatted,
    }


def build(reg, synth) -> None:  # noqa: ARG001 — same signature as every domain builder
    _suggestions(reg)
    _places(reg)
    _reverse(reg)


def _suggestions(reg) -> None:
    reg.add(
        "address_suggestions_populated",
        "geo",
        "array<AddressSuggestion>",
        "The user typed `88 Harb` with the device's location sent. Five Canadian results, "
        "nearest first, mixing an exact address, a building by name and a whole street. "
        "Picking one calls `getPlaceAddress` with its `place_id` and the same session token.",
        [
            _suggestion("88-harbour-street", "ADDRESS", "88 Harbour Street", "Toronto, Ontario M5J 0C3", 420),
            _suggestion("harbour-square", "POI", "Harbour Square Park", "Queens Quay West, Toronto, Ontario M5J 2G8", 610),
            _suggestion("harbour-street", "STREET", "Harbour Street", "Toronto, Ontario", 450),
            _suggestion("88-harbour-front-drive-hamilton", "ADDRESS", "88 Harbour Front Drive", "Hamilton, Ontario L8L 8M8", 58210),
            _suggestion("88-harbourview-drive-mississauga", "ADDRESS", "88 Harbourview Drive", "Mississauga, Ontario L5H 2T8", 24130),
        ],
        operations=["suggestAddresses"],
        tags=["geo"],
    )

    reg.add(
        "address_suggestions_broad",
        "geo",
        "array<AddressSuggestion>",
        "The user typed a postal code area or a district, not a street address: a postcode, "
        "a neighbourhood and a city. None of these fills the whole form; the user drags the "
        "pin and types the street.",
        [
            _suggestion("m5j-0c3", "POSTCODE", "M5J 0C3", "Toronto, Ontario", 380),
            _suggestion("harbourfront", "NEIGHBOURHOOD", "Harbourfront", "Toronto, Ontario", 510),
            _suggestion("toronto", "PLACE", "Toronto", "Ontario", 2900),
        ],
        operations=["suggestAddresses"],
        tags=["geo", "edge"],
    )

    reg.add(
        "address_suggestions_without_location",
        "geo",
        "array<AddressSuggestion>",
        "Location permission denied and no location sent: results are ranked towards the "
        "default address or `default_map_center`, and `distance_m` is null on every row. A "
        "denied permission never blocks the address form.",
        [
            _suggestion("2-bloor-street-west", "ADDRESS", "2 Bloor Street West", "Toronto, Ontario M4W 3E2", None),
            _suggestion("2-bloor-street-east", "ADDRESS", "2 Bloor Street East", "Toronto, Ontario M4W 1A8", None),
            _suggestion("bloor-street-west", "STREET", "Bloor Street West", "Toronto, Ontario", None),
        ],
        operations=["suggestAddresses"],
        tags=["geo", "degraded"],
    )

    reg.add(
        "address_suggestions_empty",
        "geo",
        "array<AddressSuggestion>",
        "No match: `200` with an empty list, not an error. The list says nothing matched and "
        "keeps \"Enter address manually\" and the map pin one tap away.",
        [],
        operations=["suggestAddresses"],
        tags=["geo", "edge", "empty"],
    )


def _places(reg) -> None:
    reg.add(
        "place_address_full",
        "geo",
        "GeocodedAddress",
        "A picked street address: every field the form needs is filled. The user adds the "
        "unit and buzzer, may drag the pin, and the pin's final position is what is saved.",
        _address("ADDRESS", "88 Harbour Street", "Toronto", "ON", "M5J 0C3", 43.6412, -79.3810,
                 "88 Harbour Street, Toronto, Ontario M5J 0C3"),
        operations=["getPlaceAddress"],
        tags=["geo"],
    )

    reg.add(
        "place_address_poi",
        "geo",
        "GeocodedAddress",
        "A picked building by name: `name` is set and the street address comes with it.",
        _address("POI", "290 Bremner Boulevard", "Toronto", "ON", "M5V 3L9", 43.6426, -79.3871,
                 "CN Tower, 290 Bremner Boulevard, Toronto, Ontario M5V 3L9", name="CN Tower"),
        operations=["getPlaceAddress"],
        tags=["geo"],
    )

    reg.add(
        "place_address_street_only",
        "geo",
        "GeocodedAddress",
        "A whole street with no number: `line1` is the street and `postal_code` is null, "
        "because a street spans many. The form asks for the number and postal code.",
        _address("STREET", "Harbour Street", "Toronto", "ON", None, 43.6416, -79.3793,
                 "Harbour Street, Toronto, Ontario"),
        operations=["getPlaceAddress"],
        tags=["geo", "edge"],
    )

    reg.add(
        "place_address_postcode",
        "geo",
        "GeocodedAddress",
        "A postal code area: no `line1`, the pin at the area's centre. The user types the "
        "street and drags the pin to the door.",
        _address("POSTCODE", None, "Toronto", "ON", "M5J 0C3", 43.6410, -79.3812,
                 "Toronto, Ontario M5J 0C3"),
        operations=["getPlaceAddress"],
        tags=["geo", "edge"],
    )

    reg.add(
        "place_address_province_not_served",
        "geo",
        "GeocodedAddress",
        "A Canadian address outside the provinces served at launch (Ontario only). It is "
        "returned, because search is Canada-wide; the client warns by comparing `province` "
        "with `getPublicConfig.served_provinces`, and saving it is `PROVINCE_NOT_SERVED`.",
        _address("ADDRESS", "1001 Rue Sherbrooke Ouest", "Montréal", "QC", "H3A 1G5", 45.5040, -73.5770,
                 "1001 Rue Sherbrooke Ouest, Montréal, Québec H3A 1G5"),
        operations=["getPlaceAddress", "reverseGeocode"],
        tags=["geo", "edge"],
    )


def _reverse(reg) -> None:
    reg.add(
        "reverse_geocode_address",
        "geo",
        "GeocodedAddress",
        "The pin dropped on a building: the nearest street address fills the form. Its point "
        "is a few metres from the pin; the client keeps the pin, which is what is saved.",
        _address("ADDRESS", "21 Iceboat Terrace", "Toronto", "ON", "M5V 4A8", 43.6403, -79.3958,
                 "21 Iceboat Terrace, Toronto, Ontario M5V 4A8"),
        operations=["reverseGeocode"],
        tags=["geo"],
    )

    reg.add(
        "reverse_geocode_street_only",
        "geo",
        "GeocodedAddress",
        "The pin dropped in a park beside a street with no numbered building close by: the "
        "street alone, with no postal code. The user types the number and postal code.",
        _address("STREET", "Charlton Avenue East", "Hamilton", "ON", None, 43.2509, -79.8661,
                 "Charlton Avenue East, Hamilton, Ontario"),
        operations=["reverseGeocode"],
        tags=["geo", "edge"],
    )
