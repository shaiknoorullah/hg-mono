# HalalBadge

The single differentiator, rendered as a seal. It appears on every restaurant card, the menu header, receipts and order history.

```jsx
<HalalBadge state={restaurant.halal_display_state} restaurantId={restaurant.id}
  expiresOn={restaurant.halal_expires_on} />
<HalalBadge state={cert.display_state} size="lg" surface="detail"
  certifyingBodyName={cert.certifying_body_name} expiresOn={cert.expires_on} onPress={openPanel} />
<HalalBadge state={r.halal_display_state} surface="operational" />
```

| `state` | Renders |
|---|---|
| `CERTIFIED` | Filled seal `halal.certified.seal` with a 1.5px brass **outer** ring, a **solid** shield and "Halal certified" |
| `EXPIRING_SOON` | Its own look: the amber `halal.expiring.tint` plate with a 1.5px `halal.expiring.border`, the **solid-clock** shield in `halal.expiring.icon`, the label in `halal.expiring.text`, no brass ring, and "Halal certified · expires 14 Oct" (from `expiresOn`). **Never red** and never the solid green seal: the certificate is still valid today. Without a parseable `expiresOn` it reads "Halal certified" on the same amber plate |
| `EXPIRED` | Filled **slate** seal with an **outline** (hollow) shield, no ring, "Certification expired". **Never red**: red reads as haram, a ruling the platform does not make |
| `UNVERIFIED` | `card` or `detail` render **nothing**. `operational` renders a dashed outline, a dashed shield and "Not verified" |
| `null`, `undefined` or unknown | **Nothing**, plus `reportClientError('HALAL_DISPLAY_STATE_MISSING')`. **There is no "assume certified".** |

- **States are the contract enum verbatim** (`HalalDisplayState` in `contracts/openapi.yaml`). **Surfaces** are `card`, `detail` and `operational`.
- **The whole badge is the seal.** The label sits on the filled plate (7:1 or better), heights are 20, 24 and 32, and the radius is `radius.md`. This is the **only solid green** in the system.
- **Fixed copy.** The visible and accessible labels are the reviewed strings: "Halal certified", "Halal certification expired. This restaurant cannot take orders." and "Halal certification not verified." On the detail surface the name becomes "Halal certified by {body}. Valid until {date}." Callers cannot template them.
- **The expiring date.** `expiresOn` is a wire date. For `EXPIRING_SOON` the visible label carries it as a short date ("Halal certified · expires 14 Oct", an owner-approved exception to the written-out date rule, because the badge is a one-line seal); the accessible name always says it in full: "Halal certified. Expires 14 October 2026." (on the detail surface, "Halal certified by {body}. Expires {date}."). The month table is fixed English, so no locale turns it into "Sept." The label on the amber plate is 5.91:1 (`contrast.light.expiring-text-on-expiring-tint`): AA, below the 7:1 of the other seals.
- `onPress` works only on the `detail` surface. It gives a button role, a chevron and a hit area of 44px or more. The badge never animates and never sits on a photograph.
- Install the host app's reporter with `setClientErrorReporter` (the default logs to the console).
