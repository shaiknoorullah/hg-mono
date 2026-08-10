"""
Order arithmetic, in integer cents, so a fixture's total is the total its lines imply.

If a fixture's money did not add up, four app agents would spend a week each discovering
that independently. Rounding is `round_half_up`, symmetric away from zero for negatives —
contradiction log #4, resolved in favour of platform §G-2/§P-12.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from synth import uuid_for
from world import HST_RATE

ONTARIO_HST = Decimal(HST_RATE)


def round_half_up(value: Decimal) -> int:
    """Half-up, symmetric away from zero, so a full refund reverses a charge exactly."""
    if value < 0:
        return -int((-value).to_integral_value(rounding=ROUND_HALF_UP))
    return int(value.to_integral_value(rounding=ROUND_HALF_UP))


def hst_on(base_cents: int) -> int:
    return round_half_up(Decimal(base_cents) * ONTARIO_HST)


def quote_line(
    line_no: int,
    item: dict,
    quantity: int = 1,
    *,
    variant: tuple[str, str, int] | None = None,
    addons: list[tuple[str, int, int]] | None = None,
    special_request: str | None = None,
) -> dict:
    """`variant` is (name, pricing_mode, part_cents); `addons` is [(name, qty, unit_cents)]."""
    base = item["price_cents"]
    variant_part = 0
    variant_id = None
    variant_name = None
    variant_mode = None
    if variant:
        variant_name, variant_mode, variant_part = variant
        variant_id = uuid_for(f"variant:{item['id']}:{variant_name}")

    addon_rows = []
    addons_part = 0
    for name, qty, unit in addons or []:
        addon_rows.append(
            {
                "addon_id": uuid_for(f"addon:{item['id']}:{name}"),
                "addon_name": name,
                "addon_quantity": qty,
                "addon_price_cents": unit,
            }
        )
        addons_part += qty * unit

    unit_cents = base + variant_part + addons_part
    return {
        "line_no": line_no,
        "menu_item_id": item["id"],
        "menu_item_name": item["name"],
        "variant_id": variant_id,
        "variant_name": variant_name,
        "variant_pricing_mode": variant_mode,
        "addons": addon_rows,
        "quantity": quantity,
        "base_price_cents": base,
        "variant_part_cents": variant_part,
        "addons_part_cents": addons_part,
        "line_unit_cents": unit_cents,
        "line_total_cents": unit_cents * quantity,
        "special_request": special_request,
        "tax_category": item["tax_category"],
    }


def price_quote(
    lines: list[dict],
    *,
    tip_cents: int = 0,
    delivery_fee_cents: int = 449,
    service_fee_cents: int | None = None,
    discount: dict | None = None,
    fulfilment: str = "DELIVERY",
) -> dict:
    """Returns the money block shared by `Quote`, `OrderMoney` and `Receipt`."""
    subtotal = sum(line["line_total_cents"] for line in lines)
    if service_fee_cents is None:
        service_fee_cents = round_half_up(Decimal(subtotal) * Decimal("0.05"))
    if fulfilment == "PICKUP":
        delivery_fee_cents = 0

    d_items = d_delivery = d_service = 0
    if discount:
        target = discount["target"]
        amount = discount["amount_cents"]
        if target == "ITEMS":
            d_items = amount
        elif target == "DELIVERY_FEE":
            d_delivery = min(amount, delivery_fee_cents)
        else:
            d_service = min(amount, service_fee_cents)

    taxable = (subtotal - d_items) + (delivery_fee_cents - d_delivery) + (service_fee_cents - d_service)
    hst = hst_on(taxable)

    total = taxable + hst + tip_cents

    tax_lines = [
        {
            "jurisdiction_code": "CA-ON",
            "tax_kind": "HST",
            "statutory_label": "HST (13%)",
            "rate": HST_RATE,
            "base_cents": taxable,
            "amount_cents": hst,
            "rebate_applied": False,
            # O-01 is open; the contract lets this switch per line without a schema change.
            "remittable_by": "RESTAURANT",
        }
    ]

    return {
        "subtotal_cents": subtotal,
        "discount_items_cents": d_items,
        "discount_delivery_cents": d_delivery,
        "discount_service_cents": d_service,
        "discount_cents": d_items + d_delivery + d_service,
        "delivery_fee_cents": delivery_fee_cents,
        "service_fee_cents": service_fee_cents,
        "tax_lines": tax_lines,
        "tax_total_cents": hst,
        "tip_cents": tip_cents,
        "total_cents": total,
        "currency": "CAD",
    }


def order_money(priced: dict) -> dict:
    """`OrderMoney` — the customer-facing decomposition frozen onto the order."""
    return {
        "subtotal_cents": priced["subtotal_cents"],
        "discount_cents": priced["discount_cents"],
        "delivery_fee_cents": priced["delivery_fee_cents"],
        "service_fee_cents": priced["service_fee_cents"],
        "tax_lines": priced["tax_lines"],
        "tax_total_cents": priced["tax_total_cents"],
        "tip_cents": priced["tip_cents"],
        "total_cents": priced["total_cents"],
        "currency": "CAD",
    }


def restaurant_money(priced: dict) -> dict:
    """Commission is 0% at launch (decisions S-01 / R-01), so net == subtotal - discount."""
    commission = 0
    return {
        "subtotal_cents": priced["subtotal_cents"],
        "discount_cents": priced["discount_cents"],
        "commission_cents": commission,
        "restaurant_net_cents": priced["subtotal_cents"] - priced["discount_cents"] - commission,
        "total_cents": priced["total_cents"],
        "currency": "CAD",
    }


def internal_money(priced: dict, *, ledger_entries: list[dict] | None = None) -> dict:
    """Rider earnings are a pure pass-through of the delivery fee plus 100% of tips
    (contradiction log #7, decision R-02)."""
    commission = 0
    rider = priced["delivery_fee_cents"] - priced["discount_delivery_cents"] + priced["tip_cents"]
    return {
        "commission_cents": commission,
        "restaurant_net_cents": priced["subtotal_cents"] - priced["discount_items_cents"],
        "rider_earnings_cents": rider,
        "platform_gross_cents": priced["service_fee_cents"] - priced["discount_service_cents"],
        "ledger_residual_cents": 0,
        "ledger_entries": ledger_entries or [],
        "currency": "CAD",
    }


def order_lines_from_quote(quote_lines: list[dict]) -> list[dict]:
    """`QuoteLine[]` → `OrderLine[]`: the same numbers in the order projection's shape."""
    out = []
    for ql in quote_lines:
        out.append(
            {
                "line_no": ql["line_no"],
                "menu_item_id": ql["menu_item_id"],
                "name": ql["menu_item_name"],
                "variant_name": ql["variant_name"],
                "addons": ql["addons"],
                "quantity": ql["quantity"],
                "special_request": ql["special_request"],
                "unit_price_cents": ql["line_unit_cents"],
                "line_total_cents": ql["line_total_cents"],
                "currency": "CAD",
            }
        )
    return out
