# Button

Use for any action; `primary` is the orange CTA and there is one per view.

```jsx
<Button variant="primary" size="lg" iconStart="cart" fullWidth onPress={add}>Add to order</Button>
<Button variant="tertiary">Track order</Button>
<Button loading={placing} onPress={place}>Place order</Button>
<Button critical variant="primary" onPress={accept}>Accept</Button>
<Button variant="tertiary" href="/menu">View menu</Button>
```

- **Variants**: primary, secondary, tertiary, ghost, danger. There is no `success` variant (RULE H-1); a confirm action is `primary`.
- **Sizes**: sm 36, md 44, lg 52, xl 60, plus `critical` (72) for deadline actions. `sm` keeps its 36px visual but gets a 44px hit area; there is no "desktop only" exemption.
- **Pressed** works for mouse, touch and keyboard (Enter/Space): overlay plus scale 0.98 at `duration.instant`. **Hover** only on pointer devices.
- **Focus**: two-layer ring (2px offset + 3px `border.brand`), flipping to `focus.onColor` on the brand, forest and danger fills.
- **Disabled** is `aria-disabled`, not the `disabled` attribute: the button stays focusable so it can explain itself, and clicks/Enter/Space are prevented, so a disabled `type="submit"` never submits.
- **Loading** is not disabled: full colour, label kept, width frozen, `aria-busy`, re-entry ignored.
- A button that navigates uses `href` and announces as a link.
- Renamed from the previous API: `outline` → `tertiary`, `destructive` variant → `danger`, `leftIcon`/`rightIcon` → `iconStart`/`iconEnd`, `onClick` → `onPress` (onClick still fires), size `lg` 56 → 52, `critical` size → `critical` flag.
