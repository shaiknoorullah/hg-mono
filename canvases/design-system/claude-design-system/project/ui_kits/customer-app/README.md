# Customer app (Expo / React Native, phone-first)

The HalalGoes consumer surface, one artboard per screen in `apps/customer`: phone sign-in,
Discover, Search, restaurant, item sheet, cart, checkout, live tracking, orders, alerts,
profile, addresses, rating and the tamper report. Cream canvas, white cards, orange CTA.

The live preview is `components/Index2/preview.html`. Its toolbar picks a **Screen**, a
**Variant** (for screens with several server states) and a **State** (Populated / Loading /
Empty / Error). "Show component gaps" outlines every placeholder that stands in for a
component the design system does not have yet (#109). Deep link: `#screen=checkout&variant=declined&state=populated`.

## Rules the kit follows
- **The server prices every order.** Every amount is a `*_cents` field from the API (cart
  `line_total_cents`, quote lines). Nothing is added, taxed or tipped on the phone. Tax lines
  render only from `quote.tax_lines[].statutory_label`; while O-01 is open the server sends none.
  The tip is sent as `tip_cents`; the percentage presets only pick it.
- **A halal badge comes only from data** (`restaurant.halal.display_state`). A missing field
  renders no badge; the Discover sample includes one such card. Never red for halal.
- **No pre-ticked consent.** Checkout has no SMS consent (O-03 is open); order updates are app
  notifications, and marketing email is off by default in Profile.
- Tabs match the app: Discover / Orders / Alerts / Profile.

## Files (`components/Index2/`)
| File | What |
|---|---|
| `Kit.jsx` | Shared kit frame + Gap placeholders (same file in every kit) |
| `Photo.jsx` | Placeholder for the missing Image/MediaFrame component: takes `image_url`, designed no-image fallback |
| `Data.jsx` | Sample payloads shaped like `contracts/openapi.yaml` (UUIDv7 ids, order codes) |
| `Common.jsx` | `Halal` (passes `halal.display_state` verbatim to HalalBadge), OrderState → Badge, tab bar, screen scaffold |
| `SignInScreen.jsx` | Phone OTP: phone, code, wrong code, locked |
| `HomeScreen.jsx` | Discover (FeedSection rows of RestaurantCard) and Search |
| `RestaurantScreen.jsx` | Restaurant (availability banners, menu categories, out-of-stock rows, HalalCertificationPanel from the CertificationPanel payload), item sheet, certificate viewer |
| `CheckoutScreen.jsx` | Cart and checkout (quote lines, address picker, payment method, 3-D Secure, declined, quote expired) |
| `TrackingScreen.jsx` | Tracking for every order state (StatusTimeline `audience="customer"` from `OrderTracking.timeline`; restaurant-response Countdown), seal events, tamper report, rating (Rating `input`) |
| `AccountScreens.jsx` | Orders, Alerts, Profile, Addresses, address form |
| `CustomerApp.jsx` | Entry: the artboard list |

Built against the #107 component APIs (Solar icons, contract-enum HalalBadge, Modal/Sheet `contained`, RadioGroup, Countdown `expiresAt/serverNow/windowSeconds`).

Restaurant names, prices, certificate numbers and menu copy are sample content, not real listings.
