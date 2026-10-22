"""States the admin refund boards draw and no fixture described.

Both are copies of a fixture that already exists, with one field changed, so the rest of the
shape is exactly what the contract's other fixtures already vouch for:

* `order_admin_view_delivered_no_halal`: the order of `order_admin_view_delivered` at a restaurant
  that has no halal status on file. `OrderRestaurantRef.halal` is optional in the contract, and
  a missing halal field renders no badge, never an optimistic one
  (https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).
  Every other order fixture carries a certified restaurant.
* `refund_submitted_no_split`: the refund of `refund_submitted` without `liability_split`, which
  the contract allows on any state (`null`). A client must not assume the split is there.

Nothing here is a design board's copy.
"""

from __future__ import annotations

import copy

from dom_admin_order_states import order_code
from synth import uuid_for


def build(reg, synth) -> None:
    delivered = copy.deepcopy(reg.fixtures["order_admin_view_delivered"].payload)
    name = "delivered_no_halal"
    delivered["id"] = uuid_for(f"order:admin-states:{name}")
    delivered["code"] = order_code(name)
    delivered["payment"]["order_id"] = delivered["id"]
    delivered["restaurant"].pop("halal", None)
    reg.add(
        f"order_admin_view_{name}",
        "orders",
        "OrderAdminView",
        "The staff projection of an order in `DELIVERED` at a restaurant with no halal status on file: "
        "`restaurant.halal` is absent. Screens draw no badge for it, "
        "never a certified or an expired one in its place.",
        delivered,
        operations=["getOrderAdmin"],
        tags=["admin", "order-state-matrix"],
    )

    submitted = copy.deepcopy(reg.fixtures["refund_submitted"].payload)
    submitted["id"] = uuid_for("refund:no-split:submitted")
    submitted["liability_split"] = None
    reg.add(
        "refund_submitted_no_split",
        "refunds",
        "Refund",
        "Sent to Stripe, awaiting acknowledgement, and the response carries no `liability_split`. The "
        "contract allows `null` on any state, so a screen shows the refund without saying who bears it.",
        submitted,
        operations=["getRefund", "createRefund", "issueRefund"],
        tags=["refund-state-matrix"],
    )
