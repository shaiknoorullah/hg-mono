/**
 * `@hg/ui-native/lint` — the design-system lint plugin.
 *
 * Today it carries one rule, **L-4 no green solids**, which is RULE H-1 in executable form.
 * The other rules named in foundations §9 (L-1 no raw colour, L-2 no ramp steps in
 * components, L-3 halal namespace, L-5 no float money, L-6 contrast, L-7 no physical
 * properties) belong to the same plugin and slot in beside it.
 *
 * Apps consume it as:
 *
 *     import hg from '@hg/ui-native/lint';
 *     export default [{ plugins: { hg }, rules: { 'hg/no-green-solids': 'error' } }];
 */
import noGreenSolids from './rules/no-green-solids.cjs';

const plugin = {
  meta: { name: '@hg/ui-native/lint', version: '0.0.0' },
  rules: {
    'no-green-solids': noGreenSolids,
  },
};

export default plugin;
export { noGreenSolids };
