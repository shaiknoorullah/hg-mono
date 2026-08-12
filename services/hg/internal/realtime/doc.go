// Package realtime owns the single WebSocket, its channels and the outbox relay.
//
// Responsibility: authenticate an upgrade from a single-use ticket, fan out
// events over five channels with a per-channel sequence, and let a reconnecting
// client replay what it missed from Postgres.
//
// Spec: docs/spec/01-platform.md §P-20 to §P-23, and contracts/websocket.md,
// which is the only realtime contract.
//
//   - P-20 Connection authentication. Identity is resolved server-side from a
//     30-second, single-use ticket, consumed by a conditional UPDATE on upgrade.
//     The inbound frame schema has no identity field at all, so a client cannot
//     assert who it is — that is unrepresentable, not merely rejected.
//   - P-21 Channels and subscriptions
//   - P-22 Event catalogue and envelope. Deleting a field is breaking: bump the
//     envelope's `v` and keep emitting the old version through the deprecation
//     window.
//   - P-23 Delivery guarantees, replay and multi-replica fan-out. Redis carries
//     the fan-out; replay reads Postgres. G-1 holds: a Redis flush costs live
//     fan-out, never a lost event.
//
// One transport, not two: the restaurant spec's SSE endpoint and the rider
// spec's separate /ws were both resolved to a single /v1/ws (contradiction #12).
// Two transports would mean two authorization surfaces.
//
// TODO: the outbox relay is a background runtime concern — see P-39 alongside
// the deadline runner and the schedulers.
package realtime
