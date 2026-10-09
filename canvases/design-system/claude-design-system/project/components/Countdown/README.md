# Countdown

Counts down to a server deadline: the rider offer, the restaurant's accept window, cart expiry. It never counts local seconds.

```jsx
<Countdown variant="ring" expiresAt={offer.expires_at} serverNow={res.server_time}
  windowSeconds={30} onExpire={refetch} label="to accept" />
```

- There is **no `seconds` prop**. `expiresAt` and `serverNow` are both required. Clock skew is `serverNow − deviceNow`. Above 5 s the countdown runs on `serverNow` plus monotonic elapsed time, so a device 10 minutes fast still shows about 30 s.
- If the deadline had already passed at mount, the component renders nothing and fires `onExpire` once, so the caller can re-fetch. It never shows a negative number.
- States by remaining fraction of `windowSeconds`: normal (`info.500`), urgent (below 25%, `warning.600`), critical (below 10%, `danger.500` plus a 1 Hz pulse suppressed under reduced motion), expired (`onExpire` fires exactly once).
- Linear only, tabular figures. The numeral is `aria-live="off"`. A separate assertive region announces once each at 50%, 25%, 10% and 0.
- `onExpire` can change on every render without restarting the timer.
