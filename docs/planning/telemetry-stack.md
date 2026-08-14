# Technical telemetry plane — OpenTelemetry + ClickStack

_Halal Goes. **Scope: technical/operational telemetry** — metrics, logs, traces (+ session replay)
for running the system. Distinct from the **marketing-intelligence plane**
(`growth-stack.md`) and from the **OLTP source of truth**. This plane can and should land
**earlier than the v2 marketing plane** — it's launch/ops infrastructure, not growth._

## Why separate from marketing

Same events, different consumers and guarantees. Telemetry is high-volume, short-retention,
engineer-facing, and unsampled-at-source-then-sampled; marketing data is consented,
long-retention, and business-facing. Different store, different access, different lifecycle.
They must not be conflated — a trace is not a funnel event.

## Standard: OpenTelemetry (all three signals)

Instrument **against OpenTelemetry** (vendor-neutral, like OpenFeature for flags), so the
backend is swappable. Emit **metrics, logs, and traces** with **semantic conventions**, all
correlated by `trace_id`.

- **Traces** — every request is a span tree: chi HTTP middleware → handler → pgx query spans →
  Redis spans → MinIO spans → Stripe calls → the dispatch ticker goroutine. This is where the
  modular-monolith pays off: no network hops means one clean in-process trace per order action.
- **Metrics** — RED (Rate/Errors/Duration) per route; business gauges (orders in each state,
  dispatch offers outstanding, `deadline_at` breaches, capture/void success); infra (pgx pool,
  Redis latency, queue depth). Emit via OTLP.
- **Logs** — structured JSON, **stamped with `trace_id`/`span_id`** so a log line jumps to its
  trace. Levels controlled per-environment.

## Backend: ClickStack (HyperDX + OTel Collector + ClickHouse)

**ClickStack** (ClickHouse's open-source observability stack, ex-HyperDX, launched May 2025):
bundles an **OpenTelemetry Collector** + **ClickHouse** (storage) + **HyperDX UI** (Lucene +
full-SQL search, auto-correlation of logs/traces/metrics/replay). Self-hosted OSS; a managed
option exists if we ever want it.

- ClickHouse here is **packaged and purpose-built** for telemetry — this is *not* "bare
  ClickHouse" ops, and it's a **separate instance** from any marketing warehouse.
- One store for all four signals → correlation at the database layer (click a slow trace → its
  logs → the metric spike), which is the whole point.

## Sampling (required — telemetry at scale is unaffordable otherwise)

- **Traces:** **tail-based sampling at the OTel Collector** — keep 100% of errors + slow
  outliers, sample the healthy fast majority (e.g. 5–10%). Tail-based (not head) so we decide
  *after* seeing the whole trace, never dropping a request that turned out to fail.
- **Metrics:** not sampled — aggregated; cheap and complete.
- **Logs:** level-based (INFO+ in prod, DEBUG on demand); error/warn always kept; high-volume
  debug lines sampled or dropped. Keep anything on a money or halal-state path.
- **Retention:** short hot window in ClickHouse (e.g. 15–30 days), tiered/expired after.

## Instrumentation plan

- **Go backend** — OTel SDK + `otelhttp` (chi), `otelpgx` (pgx), Redis + MinIO + Stripe
  instrumentation, custom spans/metrics for the order machine and dispatch ticker. Propagate
  context through every package call (trivial — it's a monolith).
- **Apps** — OTel web / React Native SDKs for the two consoles + two Expo apps: crash/error,
  key user timings (TTI, screen loads), and network spans that stitch to backend traces via
  propagated headers → true end-to-end (tap → API → DB) traces.
- **Correlation** — one `trace_id` from app tap through backend to DB, visible in HyperDX.

## Boundaries

- Telemetry never reads/writes OLTP tables; it observes the process, not the business data.
- No PII in spans/logs (no KYC, no raw phone, no card data) — same discipline as the marketing
  plane, enforced at the SDK.
- Alerting on RED + business SLOs (e.g. `deadline_at` breach rate, capture failure rate) from
  ClickStack/Grafana-on-ClickHouse.

## Timing

Land a **thin slice at/before v1 launch** (traces on the order path + RED metrics + error logs)
— you want observability the day real orders flow. Deepen instrumentation and add app-side
tracing through v1→v2. The marketing plane (`growth-stack.md`) is a later, separate build.
