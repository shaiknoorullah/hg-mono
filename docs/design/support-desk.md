# Support desk — headless Chatwoot, native admin UI

_HalalGoes — admin console. **Buy the engine, build the UX.** Chatwoot runs headless as the
support substrate; the agent experience is built **into our admin console** so support happens
in the operational context (an order, a customer, a rider) with no app-switching. Captured Aug
2026 from product direction._

## Why headless

Sending agents to a separate Chatwoot UI is the friction. Chatwoot's own dashboard is a Vue SPA
over a versioned **Application API + ActionCable** WebSockets — the same surface we consume, so a
custom agent UI is a supported use, not a hack. We keep Chatwoot's hard parts (channel
connectors, agent/team model, CSAT, reports, automation) and own the interface.

## Division (respects the no-overlap rule)

| Owned by **Chatwoot** (engine) | Owned by **our admin** (UI + context) | Stays in the **platform** (don't duplicate) |
|---|---|---|
| Conversations/tickets, messages, contacts, inboxes (email/WhatsApp/SMS/web), teams/agents, labels, CSAT, canned responses, automation, **reports** | Inbox/thread/composer, assignment, SLA view, **in-context panels** on order/customer/rider/restaurant, team-performance dashboards | **Dispute/refund cases (A-33/A-35)** — linked to conversations, never re-implemented in Chatwoot |

## Features, mapped

- **Tickets** = Chatwoot **conversations** (status open/pending/resolved/snoozed, **priority**,
  SLA, team routing). Rendered natively in admin.
- **Email** = Chatwoot **email inbox** channel → conversations. Native to Chatwoot; we render it.
- **Calling** — Chatwoot's native Twilio Voice is **beta + paid-gated**, so we integrate
  **Twilio Voice + a WebRTC softphone directly in the admin** (browser call/receive, recording),
  and **log each call to Chatwoot** as a conversation activity (caller, duration, status,
  recording link). Reuses the same proxy/click-to-call decided for the order-detail contacts.
- **Incidents** — _needs your definition_ (see open question). Default assumption: a **support
  escalation** = a high-priority conversation **linked to** an operational **case** (dispute/
  refund A-33/A-35, or a safety case), not a new duplicate object.
- **Team performance tracking** — Chatwoot **Agent Reports** (conversations handled, first-
  response time, resolution time, CSAT) via the reports API → our **native dashboards** (and/or
  Metabase on the reporting data). Per-agent and per-team.

## The friction win — support in context

From the **order-detail view** and the customer/rider/restaurant records:
- see **linked conversations** + open ticket status/SLA/CSAT inline,
- **reply / create ticket / place a call / log a note** without leaving the record,
- one **`external_id` link** stitches a Chatwoot contact ↔ our customer/rider/restaurant so
  history follows the person.

## Architecture

- **Chatwoot self-hosted (community edition)** as the engine; our admin (React + shadcn) consumes
  **Application API** (REST) + **ActionCable** (real-time inbox, no polling) + **webhooks**.
- **SSO** so agents authenticate once (our admin), mapped to Chatwoot agents.
- **Voice:** Twilio Voice + WebRTC in admin; call events → Chatwoot activity + our order timeline.
- **Reports:** Chatwoot reports API → our dashboards.
- No support tool touches OLTP order tables; it references orders by id and links to cases via
  the platform API.

## Effort & phasing (honest)

A full native agent inbox is a real build — phase it:
- **Phase 1 — in-context support** (highest value): the linked-conversations + quick-reply +
  create-ticket + call panels on the order/customer records. Kills most of the friction because
  support lives where the operational work is.
- **Phase 2 — full native inbox/queue** in admin for agents who live entirely in our console.
- **Interim:** SSO + optionally embed Chatwoot's own inbox for deep queue work until Phase 2.
- **Timing:** v1.x/v2 — support tooling scales with the team; at launch a small team can use
  Phase 1 in-context + Chatwoot's UI for the queue.

## Incidents — decided

An **"incident" = a support escalation**: a high-priority Chatwoot conversation **linked to** an
operational **case** (dispute/refund A-33/A-35, or a safety case), surfaced with escalation
status/priority in the admin. It is **not** a new duplicate object, and it is **not** an
operational/system incident (outage/on-call — that's a separate status-page/on-call tool, out of
scope here). Escalating a ticket creates/links the case via the platform API and bumps priority +
routing; the case remains the platform's system of record.
