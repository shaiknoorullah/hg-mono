# Modal

Blocks the view for confirmations and short forms. It replaces `Dialog`.

```jsx
<Modal open={asking} variant="confirm" destructive title="Cancel this order?"
  description="The authorisation on your card is released. This cannot be undone."
  confirmLabel="Cancel order" cancelLabel="Keep order" confirmLoading={cancelling}
  onConfirm={cancel} onClose={() => setAsking(false)} />
```

- **Focus is managed.** On open, focus moves in: onto the **least destructive** action for `confirm`, and onto OK for `alert`. It is trapped with Tab and Shift+Tab. On close it **returns to the trigger**.
- `role="dialog"` for `dialog`; `role="alertdialog"` for `confirm` and `alert`, which announce at once. `aria-modal`, `aria-labelledby` pointing at the title and `aria-describedby` pointing at the description.
- `dismissible` (default true) lets Escape, a scrim click and the 44px close button close it.
- The entry animation is `hg-ds-modal-in` (it no longer reuses the seal keyframe) and is suppressed under reduced motion.
- Never use a modal for something a Toast or an inline error could carry. Never use one for a rider offer: that is a non-dismissible full `Sheet`.
- `Dialog` is still exported as a deprecated alias so the kit screens render. It is not a card.
