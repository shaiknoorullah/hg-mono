#!/usr/bin/env node
/**
 * Post-processes the openapi-typescript output so every monetary value on the wire
 * carries the branded `Cents` type instead of a bare `number`.
 *
 * Why this exists
 * ---------------
 * `contracts/openapi.yaml` types money as `integer` (minor units, CAD). openapi-typescript
 * faithfully renders that as `Cents: number`, which means `<Price cents={item.price_cents} />`
 * accepts any number — including a float — and the platform invariant "money is int64 minor
 * units, never a float" degrades from a compile-time guarantee into a runtime assertion.
 *
 * Three separate component agents independently hit this and each branded at their own call
 * site with `cents(...)`, which throws mid-render if the server ever sends a non-integer.
 * A runtime throw is the wrong instrument for an invariant the type system can hold.
 *
 * This rewrite makes the generated `Cents` alias resolve to the brand declared in
 * `src/money.ts`, so every generated money field is branded transitively and passing a raw
 * number is a type error at the call site.
 *
 * Idempotent, and verified by `pnpm generate:check` — if the generator output shape changes
 * such that the anchor below no longer matches, this exits non-zero rather than silently
 * emitting an unbranded contract.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/generated/openapi.d.ts');

const ANCHOR = /^(\s*)Cents: number;$/m;
const BRANDED = "$1Cents: import('../money.js').Cents;";

const source = readFileSync(target, 'utf8');

if (source.includes("Cents: import('../money.js').Cents;")) {
  console.log('brand-money: already branded, nothing to do');
  process.exit(0);
}

if (!ANCHOR.test(source)) {
  console.error(
    'brand-money: FAILED — could not find `Cents: number;` in the generated output.\n' +
      "The generator's shape changed. Do not ship an unbranded money contract: fix this\n" +
      'script so the invariant stays compile-time enforced.',
  );
  process.exit(1);
}

writeFileSync(target, source.replace(ANCHOR, BRANDED), 'utf8');
console.log('brand-money: Cents is now branded from ../money.js');
