/**
 * Lint L-4 — the executable form of RULE H-1.
 *
 * The cases below are the ones that actually happen: someone reaches for the semantic
 * success ramp to fill a "confirmed" pill, someone pastes a teal from the chart palette, or
 * someone writes `bg-success-500` because that is what every other design system would want.
 * All three are the same mistake — a second filled green makes the halal seal ambiguous.
 */
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';

// The rule is CommonJS so the flat config, this test and a consuming app all load it the
// same way, with no build step.
const rule = require('../rules/no-green-solids.cjs') as never;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-green-solids', rule, {
  valid: [
    // The seal itself: the one filled solid green in the system.
    { code: "const s = { backgroundColor: tokens.color.halal.certified.seal };" },
    { code: "const s = { backgroundColor: halal.certified.sealDark };" },
    // A tint is explicitly permitted — light background, dark green text.
    { code: "const s = { backgroundColor: palette.success[50] };" },
    // Green as a border, an icon or text is fine; only fills are reserved.
    { code: "const s = { borderColor: palette.success[500], color: palette.success[600] };" },
    // The registered map-pin exception (foundations §2.6).
    { code: "const s = { backgroundColor: tokens.color.map.pinRider };" },
    // Out of band.
    { code: "const s = { backgroundColor: '#FFC220' };" },
    { code: "const s = { backgroundColor: palette.info[500] };" },
    { code: '<View className="bg-brand-500" />' },
    { code: '<View className="bg-halal-certified-seal" />' },
    // Unresolvable provenance is left alone: this rule does not guess.
    { code: 'const s = { backgroundColor: theme.color.feedback.success.tint };' },
  ],

  invalid: [
    {
      // The classic: filling a chip with semantic success.
      code: 'const s = { backgroundColor: palette.success[500] };',
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      code: 'const s = { backgroundColor: tokens.color.success[600] };',
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      // A raw hex nobody can trace — also an L-1 violation, caught here on the fill.
      code: "const s = { backgroundColor: '#0F766E' };",
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      // viz.7 is a teal at hue ~175: fine in a chart legend, not as a filled surface.
      code: 'const s = { backgroundColor: tokens.color.viz[7] };',
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      code: "const s = { background: 'rgb(14, 159, 110)' };",
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      code: '<View className="bg-success-500" />',
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      code: '<View className="md:bg-[#04482A]" />',
      errors: [{ messageId: 'greenSolid' }],
    },
    {
      // Both branches of a conditional fill are inspected.
      code: "const s = { backgroundColor: on ? palette.success[600] : '#FFFFFF' };",
      errors: [{ messageId: 'greenSolid' }],
    },
  ],
});
