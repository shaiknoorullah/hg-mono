# StatusTimeline

Shows order tracking on the customer, restaurant, rider and admin surfaces. It takes the order state, not labels.

```jsx
<StatusTimeline audience="customer" state={order.state} transitions={tracking.timeline}
  deadlineAt={order.deadline_at} estimatedAt={tracking.eta_at} connection={socketState} />
```

- **Driven by the contract.** You pass `state` (one of the 14 order states) plus `audience`. The steps and their words come from one shared mapping module (`ORDER_STATE_LABELS`, `resolveTimeline`, a mirror of `ui-native/src/feedback/order-track.ts`), so no two surfaces can disagree. The customer track is Placed → Confirmed → Preparing → On the way → Delivered.
- **Step states** are complete, current, `stalled` (deadline passed, warning plus "Taking longer than expected"), `failed` (CANCELLED, REJECTED or FAILED, with the reason in words), upcoming and unreached.
- **Variants** vertical (default), horizontal and compact (a bar plus the current label).
- **States.** `loading` shows a skeleton with the correct number of steps. `connection="reconnecting"` keeps the last state and says "Not updating — reconnecting"; the timeline never blanks. An unknown state is reported, never a crash.
- **A11y.** `role="list"`, and each step is named "{label}, {state}, {time}" with absolute times. The current step is `aria-current="step"`. Changes are announced politely **once**, deduplicated.
