// Which customer design boards no native flow can be captured against, and why.
//
// A customer board is a file canvases/customer/<area>/project/<Board>.dc.html on the branch
// origin/claude/redesign-canvases (568 of them). A board is covered one of two ways:
//
//   paired      a flow under native/customer/redesign/ captures it with the design-capture subflow,
//               `SHOT: design--<area>--<Board>` (tools/e2e/README.md, "Design captures"). Not listed here:
//               check-boards.mjs reads the flows.
//   unpairable  listed below, with the reason. The diff never sees a capture for it, so it is not
//               scored; a board with no capture and no reason here fails check-boards.mjs.
//
// Each entry is [pattern, reason]. The pattern is tested against "<area>/<Board>"; the first entry that
// matches a board gives its reason, so the specific entries come before the general ones. An entry that
// matches no board is stale and fails the check, so a renamed or removed board cannot hide in here.
//
// How these were decided (16 October 2026, from the rendered boards and the app, not from names):
//   - A board is a thin wrapper (dc-import name="Main" state="invalid" theme="dark" w="360"...) around a
//     template, or a template itself. The wrapper's attributes, not its file name, say dark, 360, big
//     text or keyboard. The rendered layout (tools/design-diff render-refs) gave each board's real text.
//   - A board counts as reachable only if a flow shows that screen in that state with the same shape of
//     content at the top of the screen. The comparison reads positions, so the same screen drawn from
//     other data (a different number of lines) or scrolled is not a pairing, it is a different picture.
//   - Nothing here was measured on a device: no emulator was available.

const PHONE_FLOWS = 'The customer flows run on a 390 dp wide light-theme phone with the system font size at 100 %';

export const UNPAIRABLE = [
  // --- not one screen ------------------------------------------------------------------------------
  [
    /^discover-order\/(Halal-edge-states|Focus-states|Card-text-sizes|Text-sizes-sheets)$/,
    'A reference board (a specimen of card variants, of every control focused, or of type scaled on several components), not one screen.',
  ],
  [
    /^(cart-checkout\/(Cart-offline|Checkout-add-card|Checkout-cancel-states|Checkout-cancelled|Checkout-finish-profile|Checkout-offline|Order-placed-cancel)|discover-order\/(Address-add-states|Address-picker-states|Address-search|Browse-offline|Home-offline|Motion-reduced|Restaurant-cert-sheet-expiring|Restaurant-cert-sheet-states|Restaurant-deeplink-states|Restaurant-offline|Dark-search-browse-address|Width-360))$/,
    'Several states drawn side by side on one board 868 to 1728 dp wide. No single screenshot is that picture.',
  ],

  // --- a condition the flows never set --------------------------------------------------------------
  [/^[^/]+\/[^/]*360[^/]*$/, `360 dp wide. ${PHONE_FLOWS} on the 390 dp design AVD; the 360 dp one (tools/design-diff/android/create-avd.sh design-360) runs no flow.`],
  [/^[^/]+\/[^/]*[Dd]ark[^/]*$/, `Drawn in the dark theme. ${PHONE_FLOWS}; the device-lab missions switch the phone to dark only after the flow has finished (their reality steps).`],
  [/^[^/]+\/[^/]*(-lt|text-sizes|Text-sizes|text-2x|Text2x)$/, 'Drawn with the system font enlarged to 130 % or 200 %. The flows run at 100 %; the missions enlarge the font only after the flow has finished.'],
  [/^[^/]+\/[^/]*kbd$/, 'Drawn with the on-screen keyboard open. Every flow hides the keyboard before it captures, so no capture shows it.'],
  [/^[^/]+\/[^/]*focus$/, 'A focus-ring or screen-reader reading-order state (a control focused by keyboard or TalkBack). Maestro cannot place that focus before it captures.'],

  // --- sign-in -------------------------------------------------------------------------------------
  [/^sign-in\/Blocked/, 'A forced-session screen (suspended, banned, revoked, expired, update required, security, unavailable). Reached only when the server forces the session into that state; no customer flow or dev-world scenario does.'],
  [/^sign-in\/Code-(expired|incorrect|limit|locked|timedout|verifylimit)$/, 'The server refuses the code (wrong, expired, out of tries, timed out, rate limited). The flows enter the right code, or five digits, never a refused one.'],
  [/^sign-in\/Code-(offline|resendfail|verifyfail)$/, 'Needs the network cut or the server failing during the step. No flow does either at the code step.'],
  [/^sign-in\/Code-(resend|resent|verifying)$/, 'A moment that passes (the resend timer running out, a resend just sent, the code being checked); the flows do not wait for the first or catch the others.'],
  [/^sign-in\/Main-(notyou|signedout)$/, 'Reached from "Not you?" on Your details or from Sign out on Account. No flow taps either.'],
  [/^sign-in\/Profile-validation$/, 'The board\'s form holds a last name and an unfinished email beside the first-name error. The flow leaves the form otherwise empty, so the layout (one more error line) differs.'],
  [/^sign-in\/Profile-fromcart$/, 'Reached from checkout (PROFILE_INCOMPLETE). No flow reaches checkout.'],
  [/^sign-in\/Profile-(emailrejected|error|filled|offline|saving)$/, 'Needs a refused save, a dropped network, a save still in flight, or the form filled in with consent ticked. The flows save once with a first name and nothing else.'],
  [/^sign-in\/SignedIn$/, 'A hand-off placeholder: the board draws only the app bar, a note ("next_route = HOME") and the bottom bar, and leaves Home to the Discover boards. It is not the Home screen.'],
  [/^sign-in\/SignedIn-(noaddress|restored|tracking|firstaddress)$/, 'A hand-off or contract-gap board (Home with no address is drawn properly by discover-order/Home-no-address; restored needs a deletion status the contract lacks; tracking needs an active order at sign-in; first address needs the address form).'],
  [/^sign-in\/SignIn-(limited|limitedover|lockedwait)$/, 'A rate-limit wait (429). The flows are never refused for asking too often.'],
  [/^sign-in\/SignIn-(offline|sendfail|sending|unavailable|unavailable-nosupport)$/, 'Needs the network cut, a failing server, or a request still in flight when the screenshot is taken. No flow does.'],
  [/^sign-in\/SignIn-(channel|unsupported)$/, 'Needs a channel choice the contract does not offer yet (WhatsApp or text), or a +44 number pasted into a field that cannot type one.'],

  // --- account -------------------------------------------------------------------------------------
  [/^account\/Main$/, 'Not an Account screen: a copy of the sign-in screen (sign-in/Main) with two link targets changed, imported by the Sign out offline board.'],
  [/^account\/Account-(edit.*|addemail)$/, 'The Edit details sheet. No flow opens it.'],
  [/^account\/Account-(signout|signingout|signoutfail)$/, 'The Sign out confirmation, or what follows it. No flow signs out.'],
  [/^account\/Account-(loading|error|sublineserror|sublinesloading)$/, 'A load that is still running or has failed. The flows wait for the page to load.'],
  [/^account\/Account(-.*)?$/, 'The Account page has ten variants (email confirmed or not, resend refused, no email, support line open or closed). Which one shows depends on the signed-in customer\'s profile and the support hours, which no flow sets, so no board can be named for the tab.'],
  [/^account\/(Addresses|AddressForm)(-.*)?$/, 'The saved-addresses list and the address form. No flow opens either.'],
  [/^account\/AddressSwitcher$/, 'The board draws four saved addresses and a hand-off note in place of the Home list behind the sheet. The sheet\'s height follows the customer\'s address count, which the flow does not set.'],
  [/^account\/AddressSwitcher-(error|loading|none|switched|switchfail)$/, 'A failed or pending address read, a customer with no address, or the Home header after a switch. The flow opens the sheet once, with addresses.'],
  [/^account\/WhatsNew(-.*)?$/, 'The What\'s new page (Account, then What\'s new) and the sheet shown once after an update. No flow opens either. The sheet needs a stored last-seen version, which the app cannot keep yet, and a dev build is version 0.0.0, so the page reads as empty where the boards draw the notes of versions 1.2.0 and 1.1.0.'],
  [/^account\/AppSettings(-.*)?$/, 'Built (account/AppSettingsScreen.tsx) but no flow opens it yet: Account, then App settings. Its three location states are the phone\'s permission, which no flow sets before it captures (the missions grant or revoke it only after a flow has finished).'],
  [/^account\/(NotificationSettings|EmailVerify)(-.*)?$|^account\/Legal-terms[a-z-]*$/, 'No flow opens this screen (notification settings, the email-link screen, Terms and privacy).'],

  // --- discover and order --------------------------------------------------------------------------
  [/^discover-order\/Address-picker$/, 'Superseded: the app builds the address switcher from account/AddressSwitcher (the screen file says so), not from this older drawing.'],
  [/^discover-order\/Address-(add|confirm-pin|manual)$/, 'The add-address form. No flow opens it.'],
  [/^discover-order\/(Browse|Search)-/, 'Browse (all restaurants) and Search. No flow opens either.'],
  [/^discover-order\/Cert-(failed|minting|not-found|not-viewable|offline|pdf)$/, 'A certificate view that fails, is still getting its link, is missing, not viewable, a PDF, or offline. The flows open a certificate that loads.'],
  [/^discover-order\/How-we-verify$/, 'Superseded: the app builds How we check from account/Legal (the screen file calls this the older drawing).'],
  [/^discover-order\/Home-(cart|order-in-progress)$/, 'Home with items in the cart, or with an order under way. The flow reaches Home before either exists.'],
  [/^discover-order\/Home-(error|loading|nothing-in-range|refreshing)$/, 'A failed or pending load, an address nothing delivers to, or a pull to refresh. The flow waits for Home to load, for an address it delivers to.'],
  [/^discover-order\/Item-(ready|required-addon|options-chosen|max-qty|choose|simple|photo|delta-variant|max-error)$/, 'An item sheet for a dish no flow opens. The boards draw Mixed charcoal grill (a Size group and Extras); the flows open Lamb Karahi (Portion and spice level) and Lentil Soup, and no board draws those option groups.'],
  [/^discover-order\/Item-added$/, 'The menu scrolled to the dish just added, with a toast and the cart bar. The board draws a different menu; the flow\'s menu is scrolled to a dish the board does not have, so nothing lines up.'],
  [/^discover-order\/Item-different-restaurant$/, 'The "Start a new cart?" dialog over the board\'s dish. The flow shows it over Lentil Soup\'s sheet, so what is behind it differs.'],
  [/^discover-order\/Item-/, 'An item-sheet failure or pending state (loading, error, gone, closed, paused, out of range, out of stock, offline, add refused). Needs a server answer the flows do not provoke.'],
  [/^discover-order\/Report-concern$/, 'Needs a contract operation that does not exist yet (a halal concern report not tied to an order); the board says so.'],
  [/^discover-order\/Restaurant-(cert-missing|cert-partial|panel-error)$/, 'A restaurant whose certification record is missing, partial or unreadable. The flows open certified, expiring, paused and unavailable restaurants only.'],
  [/^discover-order\/Restaurant-(closed|empty-menu|menu-error|loading|no-address|out-of-range|photo|scrolled)$/, 'A restaurant page the flows do not show: closed by its hours, with an empty or failed menu, still loading, with no address, out of range, hero photo crop, or scrolled.'],

  // --- cart and checkout ---------------------------------------------------------------------------
  [/^cart-checkout\/Cart-(default|clear-confirm|line-removed|line-updating|max-qty|quoting|undo-failed|edit-line)$/, 'A cart with the lines the board draws (two or three, one with a note and an extra). The flow\'s cart holds one line (Lentil Soup), and the totals sit below the lines, so their position is the data\'s, not the design\'s.'],
  [/^cart-checkout\/Cart-(?!empty$)/, 'A cart state the flows do not provoke: a price change, a closed or lapsed restaurant, a removed or sold-out line, no address, an order already on the way, a failed or pending load.'],
  [/^cart-checkout\/Checkout-/, 'Checkout. The flows stop at "Go to checkout" and do not open it.'],
  [/^cart-checkout\/Order-/, 'An order that has been placed. No customer flow places one.'],

  // --- tracking, orders, help, receipts ------------------------------------------------------------
  [/^track-after\/Orders-Default$/, 'Orders with an active order pinned above the past ones. The orders flow signs in as a customer with no active order, so the page opens on Past orders.'],
  [/^track-after\/Orders-RowMenu$/, 'The row menu over a list the board draws scrolled so the first past order sits under the app bar. The flow opens the menu on the unscrolled list.'],
  [/^track-after\/Orders-/, 'An Orders state the flows do not show: no orders yet, loading, a failed load, paging, the end of the list, an order under review.'],
  [/^track-after\/Receipt-Default$/, 'The receipt of the board\'s order (one line and a two-quantity line). The flow opens the dev-world order\'s receipt, whose line count it does not set, and the totals sit below the lines.'],
  [/^track-after\/Receipt-/, 'A receipt state the flows do not show: refunds, no charge, not issued yet, not completed, loading, a failed load.'],
  [/^track-after\/(Cancel|GetHelp|Outcome|Payment|Track)-/, 'Needs an order placed and then tracked, helped, cancelled, paid again or resolved. No customer flow places an order.'],
  [/^track-after\/Main$/, 'Live tracking of an order on the way. No customer flow places an order.'],
];
