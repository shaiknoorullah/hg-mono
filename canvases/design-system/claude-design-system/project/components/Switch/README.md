# Switch

For settings that apply immediately: store open or closed, rider online, item availability, admin flags.

```jsx
<Switch label="Online for deliveries" stateLabel={{ on: 'Online', off: 'Offline' }}
  checked={online} loading={saving} onCheckedChange={requestToggle} />
```

- `role="switch"` with `aria-checked` on a real button. The focus ring is on the track.
- The **off track is `border.strong`**, which clears 3:1 against the surface. The on track is `action.trackOn` (brand.600). Never green.
- **`stateLabel` is required** and shown as text, so state is never conveyed by thumb position alone.
- **`loading`** shows a spinner in the thumb, and the switch **stays in its old position** until the server confirms. There is no optimistic flip that snaps back. It sets `aria-busy` and ignores presses.
- `onChange` now receives the next boolean. Use `onCheckedChange` in new code.
