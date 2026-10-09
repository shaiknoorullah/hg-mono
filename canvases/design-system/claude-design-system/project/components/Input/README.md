# Input

Text entry. `label` is required.

```jsx
<Input label="Mobile number" variant="tel" required helperText="We text a code to sign you in." />
<Input label="Email" variant="email" value={email} onValueChange={setEmail} errorText={emailError} />
<Input label="Sign-in code" variant="otp" value={code} onValueChange={setCode} />
```

- **Focus follows the focus-indicator decision.** Default is a 1px `border.interactive`. Hover is `border.strong` (pointer devices only). **Focus is the field's own border, 2px in `border.brand`, with no ring and no glow.** An **invalid** field keeps its 2px danger border and takes the two-layer ring when focused.
- **Accessibility.** The label is required and programmatically associated. Ids come from `useId`, never from the label text, so duplicates cannot collide. `helperText` and `errorText` are linked with `aria-describedby`. `errorText` is `role="alert"` with an icon, never colour-only, and the input gets `aria-invalid`. `required` reaches the `<input>`.
- **States**: disabled, readOnly, loading (trailing spinner) and success (trailing check, no green fill).
- **Variants**: text, email, tel (+1, `autoComplete="tel-national"`), numeric, password, search, and otp (6 cells over one real field, `autoComplete="one-time-code"`, paste-aware). The tel mask `+1 (___) ___-____` is specified, not yet implemented; it arrives with the rebuild.
- Renamed: `hint` → `helperText`, `error` → `errorText`, `type` → `variant`, `leftIcon` → `iconStart`.
