# Sheet

A mobile-first overlay for item customisation, the address picker, tip selection and rider offers.

```jsx
<Sheet open={open} title="Choose a tip" onClose={close} footer={<Button fullWidth size="lg">Confirm tip</Button>}>…</Sheet>
<Sheet open variant="full" dismissible={false} title="New delivery offer">…</Sheet>
```

- **Focus.** Focus moves in on open, is trapped, and returns to the trigger on close. `role="dialog"`, `aria-modal` and `aria-labelledby` pointing at the title.
- **Always a visible way out.** When `dismissible` (the default), a 44px close button, Escape and a scrim tap all close it. The drag handle is decorative and never the only way out.
- **The rider offer** is `variant="full"` with `dismissible={false}`: no scrim tap, no Escape and no close button until the server's `expires_at`. The caller closes it. It sits at `z-offer-sheet`.
- The footer stays visible at the bottom of the panel. Native builds must use `keyboardAvoiding`.
- Replaced: `variant="offer"` → `variant="full"` + `dismissible={false}`. `open` now defaults to false.
