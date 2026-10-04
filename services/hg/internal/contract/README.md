---
covers:
  - services/hg/internal/contract/oapi-codegen.yaml
reviewed: 2026-09-28
---

# `contract` — generated Go types for `openapi.yaml`

`types.gen.go` is **generated** by [oapi-codegen] from `contracts/openapi.yaml` — one
Go type per contract component schema (431 of them: every request, response, and
nested object, with `Cents = int64`, closed enums as typed constants, and nullable
fields as pointers). **Do not hand-edit it.**

This is the "make the bug unrepresentable" floor for the contract-drift problem
(`docs/analysis/contract-drift/`): the conformance harness catches drift at *test*
time; these types let a handler catch it at *compile* time.

## Regenerate / gate

```bash
make generate-contract   # regenerate types.gen.go from the contract
make generate-check      # CI gate: fails if types.gen.go is stale or hand-edited
```

`generate-check` is part of `make check`. oapi-codegen is pinned as a `go tool`
dependency in `go.mod` (`go tool oapi-codegen`), so the gate is hermetic — no
network fetch at check time. Bump the version by editing the `tool` directive.

## Adoption (how drift becomes a compile error)

Today most handlers return hand-written DTO structs. Point a handler's response at
the generated type instead, and any field the handler sets that the contract does
not define — or any field whose type drifts — stops compiling:

```go
// before: a hand-written struct that can silently drift from the contract
return restaurantOrderView{ /* … */ }

// after: the generated type. A renamed/removed/extra/mistyped field is a build error.
return contract.OrderRestaurantView{
    Id:       o.id,
    Code:     o.code,
    State:    contract.OrderState(o.state),
    Money:    contract.RestaurantOrderMoney{ SubtotalCents: o.subtotal, /* … */ },
    Customer: contract.OrderCustomerRef{ DisplayName: name, PhoneMasked: masked },
    Lines:    lines,
    PlacedAt: o.placedAt,
}
```

Migrate incrementally, highest-drift surfaces first. The first target is the
restaurant order view (`OrderRestaurantView`, shared by six endpoints — the surface
that produced the most drift in the audit). Each migrated handler needs no
conformance test of its own to stay honest: the type itself is the contract.

[oapi-codegen]: https://github.com/oapi-codegen/oapi-codegen
