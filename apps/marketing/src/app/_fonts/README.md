# Fonts for the Open Graph card

`BricolageGrotesque-Bold.ttf` — the 700 static instance, from Google Fonts.

**Why a committed binary rather than next/font.** The social card is rendered by
Satori inside `ImageResponse`, which runs outside the browser and cannot resolve
a CSS font family, a custom property or anything next/font produces. It takes
font *bytes* or it falls back to a generic sans — which is what the card did
before this file existed, on the single most-shared brand asset we have.

Fetching it from Google at build time was the alternative and was rejected:
it makes every deploy depend on a third-party host being up, and an outage
there would silently ship the fallback again rather than fail loudly.

Only the 700 weight, and only the static instance: Satori does not interpolate a
variable axis, and the card uses exactly one weight.

**Licence.** Bricolage Grotesque is licensed under the SIL Open Font License
1.1, which permits bundling and redistribution, including inside a larger work,
provided the font is not sold on its own and the licence travels with it:
<https://openfontlicense.org>. Upstream: <https://github.com/ateliertriay/bricolage>.

To update: take the 700 `.ttf` URL from
`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800`
and replace this file. Nothing else needs to change.
