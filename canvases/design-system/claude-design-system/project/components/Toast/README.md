# Toast

A short confirmation or notice that never blocks a task.

```jsx
<Toast variant="success" title="Certificate approved" description="Zaytoun Grill is eligible to go live." onDismiss={hide} />
<Toast variant="danger" title="Payment declined" description="Try another card. Your cart is saved." onDismiss={hide} />
<Toast title="Address saved" action={{ label: 'Undo', onAction: undo }} onDismiss={hide} />
```

- Variants `neutral`, `success`, `warning`, `danger` and `info`. **There is no halal toast.** The shield is drawn only by the halal components. An admin "certificate approved" message is `success` text. `success` is a tint with a success icon, never a green fill.
- `role="status"` (polite). `danger` uses `role="alert"` (assertive).
- `duration` defaults to 5000 ms. **Danger toasts and toasts with an action are persistent.** The timer **pauses** while the pointer is over the toast or focus is inside it.
- Takes a `title` and an optional `description` (replacing `message`). Dismiss is a real 44px target.
- Never the only carrier of an error that blocks a task; that error belongs inline.
