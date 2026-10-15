// How a capture names the board it must match. tools/e2e/README.md, "Design captures".
//
//   board id      <app>/<area>/<Board>        restaurant/sign-in/SignIn-Invalid
//   capture file  design--<area>--<Board>.png in a folder named for the app (or --app)
//
// A Maestro flow writes the file with `takeScreenshot: design--<area>--<Board>`; expectDesign()
// writes it for Playwright, beside a .layout.json of what the page showed.

export const APPS = ['customer', 'rider', 'restaurant', 'admin'];

const ID = /^(customer|rider|restaurant|admin)\/([a-z0-9-]+)\/([A-Za-z0-9._-]+)$/;
const FILE = /^design--([a-z0-9-]+)--([A-Za-z0-9._-]+?)\.png$/;

/**
 * `<app>/<area>/<Board>` → its parts; throws on anything else.
 * @param {string} id
 * @returns {{ app: string, area: string, board: string }}
 */
export function parseBoardId(id) {
  const m = ID.exec(id);
  if (!m) throw new Error(`"${id}" is not a board id: <app>/<area>/<Board>, app one of ${APPS.join(', ')}`);
  return { app: String(m[1]), area: String(m[2]), board: String(m[3]) };
}

/**
 * The capture file name for a board of `area`.
 * @param {string} area
 * @param {string} board
 */
export const captureFile = (area, board) => `design--${area}--${board}.png`;

/** A capture file name → its area and board, or null when it is not one. */
export function parseCaptureFile(name) {
  const m = FILE.exec(name);
  return m ? { area: m[1], board: m[2] } : null;
}
