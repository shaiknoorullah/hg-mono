/**
 * Lint **L-4 — no green solids**. RULE H-1 in executable form.
 *
 * > No filled background may resolve to a colour whose hue is 100°–180° unless it comes
 * > from `color.halal.*`.
 *
 * The reason this rule exists rather than a guideline: we measured, and hue cannot separate
 * the halal seal from semantic success.
 *
 *     halal seal #0F7A43  vs  success.solid #067A55  →  1.30:1
 *     halal tint #E4F0E9  vs  success.tint  #E7F7F0  →  1.06:1
 *
 * There is no pair of greens that are both individually accessible and 3:1 apart from each
 * other, so the system separates them by **form**: `halal.certified.seal` is the only filled
 * solid green surface that exists. Everything else green is a tint, an outline, an icon or
 * text. This rule is what makes that true in the repository rather than in a document.
 *
 * What it inspects
 * ----------------
 *  - `backgroundColor:` / `background:` object properties (inline styles and
 *    `StyleSheet.create`), and
 *  - Tailwind/NativeWind `bg-*` utilities in `className` strings — both named
 *    (`bg-success-500`) and arbitrary (`bg-[#0F766E]`).
 *
 * How it resolves a value
 * -----------------------
 *  1. A colour literal (`#RGB`, `#RRGGBB(AA)`, `rgb()`, `hsl()`) is used directly.
 *  2. A member expression is turned into a dotted token path (`palette.success[500]`,
 *    `tokens.color.viz[7]`) and looked up in `generated/lint-tokens.json`, so the rule can
 *    never drift from the palette — it reads the same generated file the components do.
 *  3. Anything it cannot resolve is left alone. This rule does not guess.
 *
 * Exemptions, all deliberate and all narrow
 * -----------------------------------------
 *  - Provenance in `color.halal.*` — the reserved namespace (RULE H-1).
 *  - `color.map.pinRider`, the one registered non-halal use of the reserved green
 *    (foundations §2.6): a rider pin is a HalalGoes rider, it carries no shield, and it
 *    makes no certification claim.
 *  - **Tints.** RULE H-1 explicitly permits "a light background with dark green text", so a
 *    resolved colour lighter than `tintLightness` (default 0.85 HSL L) is a tint, not a
 *    fill. Saturated and mid-dark greens are fills and are reported.
 */

/**
 * CommonJS on purpose. An ESLint rule has to be loadable by the flat config (ESM), by
 * `require` from a test, and by any app that installs the plugin — and it has to read the
 * generated palette from disk. CJS is the one module format all three agree on.
 */

/** Generated from docs/design/tokens.json — see src/tokens/build.ts. */
const TOKENS = require('../../tokens/generated/lint-tokens.json');

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;
const HSL_FN = /^hsla?\(\s*([\d.]+)/i;
/** `bg-success-500`, `bg-halal-certified-seal`, `bg-[#0F766E]`, `bg-[rgb(15,118,110)]` */
const BG_UTILITY = /(?:^|\s)(?:[a-z-]+:)*bg-(\[[^\]]+\]|[a-z0-9-]+)/gi;

/** @returns {{h: number, s: number, l: number} | null} */
function toHsl(input) {
  const value = String(input).trim();

  let r;
  let g;
  let b;

  if (HEX.test(value)) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .slice(0, 3)
        .split('')
        .map((c) => c + c)
        .join('');
    }
    hex = hex.slice(0, 6);
    const int = Number.parseInt(hex, 16);
    r = ((int >> 16) & 255) / 255;
    g = ((int >> 8) & 255) / 255;
    b = (int & 255) / 255;
  } else {
    const rgb = RGB_FN.exec(value);
    if (rgb) {
      r = Number(rgb[1]) / 255;
      g = Number(rgb[2]) / 255;
      b = Number(rgb[3]) / 255;
    } else {
      const hsl = HSL_FN.exec(value);
      // An `hsl()` literal states its hue outright.
      if (hsl) return { h: ((Number(hsl[1]) % 360) + 360) % 360, s: 1, l: 0.5 };
      return null;
    }
  }

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h6 = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (((h6 * 60) % 360) + 360) % 360, s, l };
}

/** `tokens.color.success[500]` -> `color.success.500`; returns null if not a static path. */
function pathOf(node) {
  const parts = [];
  let current = node;
  while (current && current.type === 'MemberExpression') {
    if (current.computed) {
      const prop = current.property;
      if (prop.type === 'Literal' && (typeof prop.value === 'string' || typeof prop.value === 'number')) {
        parts.unshift(String(prop.value));
      } else return null;
    } else if (current.property.type === 'Identifier') {
      parts.unshift(current.property.name);
    } else return null;
    current = current.object;
  }
  if (!current || current.type !== 'Identifier') return null;
  parts.unshift(current.name);
  return parts.join('.');
}

/**
 * Normalise a source path onto the generated token paths. `tokens.color.x`, `palette.x` and
 * `color.x` are the three ways this repository names the same value.
 */
function candidates(path) {
  const out = [path];
  if (path.startsWith('tokens.')) out.push(path.slice('tokens.'.length));
  const stripped = out[out.length - 1];
  if (stripped.startsWith('palette.')) out.push(`color.${stripped.slice('palette.'.length)}`);
  if (!stripped.startsWith('color.') && !stripped.startsWith('theme.')) {
    out.push(`color.${stripped}`);
  }
  return out;
}

function resolvePath(path) {
  for (const candidate of candidates(path)) {
    const hex = TOKENS.byPath[candidate];
    if (hex) return { hex, path: candidate };
  }
  return null;
}

const isHalal = (path) => /(^|\.)halal(\.|$)/.test(path);
const isException = (path) =>
  Object.keys(TOKENS.exceptions).some((exempt) => exempt.endsWith(path) || path.endsWith(exempt));

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'RULE H-1 / lint L-4: no filled background may resolve to a hue in 100-180 outside color.halal.*',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Extra token paths or hexes allowed to fill. Registered exceptions only. */
          allow: { type: 'array', items: { type: 'string' } },
          /** Above this HSL lightness a colour is a tint, which RULE H-1 permits. */
          tintLightness: { type: 'number' },
          minSaturation: { type: 'number' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      greenSolid:
        'Filled background resolves to {{hex}} (hue {{hue}}°), which is inside the reserved ' +
        'halal band 100-180. Solid green belongs to color.halal.* alone (RULE H-1). Use a ' +
        'tint with dark green text, an outline, or an icon.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const allow = new Set((options.allow ?? []).map((s) => s.toLowerCase()));
    const tintLightness = options.tintLightness ?? 0.85;
    const minSaturation = options.minSaturation ?? TOKENS.minSaturation ?? 0.15;
    const { min, max } = TOKENS.hueBand;

    /** Report unless the colour is out of band, a tint, or legitimately sourced. */
    function check(node, hex, provenance) {
      if (provenance && (isHalal(provenance) || isException(provenance))) return;
      if (allow.has(String(hex).toLowerCase())) return;
      if (provenance && allow.has(provenance.toLowerCase())) return;

      const hsl = toHsl(hex);
      if (!hsl) return;
      if (hsl.h < min || hsl.h > max) return;
      if (hsl.s < minSaturation) return;
      // A light wash is a tint, which RULE H-1 explicitly allows.
      if (hsl.l >= tintLightness) return;

      context.report({
        node,
        messageId: 'greenSolid',
        data: { hex: String(hex), hue: String(Math.round(hsl.h)) },
      });
    }

    function checkValue(valueNode) {
      if (!valueNode) return;
      if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
        check(valueNode, valueNode.value, null);
        return;
      }
      if (valueNode.type === 'MemberExpression') {
        const path = pathOf(valueNode);
        if (!path) return;
        const resolved = resolvePath(path);
        if (resolved) check(valueNode, resolved.hex, resolved.path);
        else if (isHalal(path)) return;
        return;
      }
      if (valueNode.type === 'ConditionalExpression') {
        checkValue(valueNode.consequent);
        checkValue(valueNode.alternate);
        return;
      }
      if (valueNode.type === 'LogicalExpression') {
        checkValue(valueNode.left);
        checkValue(valueNode.right);
      }
    }

    function checkClassName(node, text) {
      for (const match of String(text).matchAll(BG_UTILITY)) {
        const raw = match[1];
        if (raw.startsWith('[')) {
          check(node, raw.slice(1, -1), null);
          continue;
        }
        const key = raw.toLowerCase();
        if (key.startsWith('halal-')) continue;
        const hex = TOKENS.byUtility[key];
        if (hex) check(node, hex, `color.${key.split('-').join('.')}`);
      }
    }

    return {
      Property(node) {
        const key = node.key;
        const name =
          key.type === 'Identifier' ? key.name : key.type === 'Literal' ? key.value : null;
        if (name !== 'backgroundColor' && name !== 'background') return;
        checkValue(node.value);
      },

      JSXAttribute(node) {
        if (node.name?.name !== 'className' || !node.value) return;
        if (node.value.type === 'Literal') {
          checkClassName(node.value, node.value.value);
          return;
        }
        if (
          node.value.type === 'JSXExpressionContainer' &&
          node.value.expression.type === 'Literal'
        ) {
          checkClassName(node.value.expression, node.value.expression.value);
        }
      },

      TemplateElement(node) {
        if (node.value?.raw?.includes('bg-')) checkClassName(node, node.value.raw);
      },
    };
  },
};

module.exports = rule;
module.exports.default = rule;
