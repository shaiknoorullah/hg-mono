/**
 * `pnpm validate:contract`
 *
 * The invariants `contracts/README.md` §"What CI enforces" promises. This is the check that
 * has to pass before anything is generated.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const CONTRACT = join(REPO, 'contracts', 'openapi.yaml');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** The three fields allowlisted to carry money inbound (`contracts/README.md` §Money). */
const MONEY_IN_REQUEST_ALLOWLIST = new Set([
  'QuoteInput.tip_cents',
  'AdminRefundInput.amount_cents',
  'RefundInput.amount_cents',
  'MenuItemInput.price_cents',
  'MenuItemUpdateInput.price_cents',
]);

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

function walk(node: unknown, path: string, visit: (n: any, p: string) => void): void {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}/${i}`, visit));
  } else if (node && typeof node === 'object') {
    visit(node, path);
    for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`, visit);
  }
}

function main(): number {
  const raw = readFileSync(CONTRACT, 'utf8');
  const spec = parseYaml(raw) as any;

  // ---------------------------------------------------------- $ref resolution
  let refCount = 0;
  walk(spec, '#', (node, path) => {
    if (typeof node.$ref !== 'string') return;
    refCount += 1;
    if (!node.$ref.startsWith('#/')) {
      fail(`${path}: external $ref not allowed (${node.$ref})`);
      return;
    }
    let cursor: any = spec;
    for (const part of node.$ref.slice(2).split('/')) {
      cursor = cursor?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (cursor === undefined) {
        fail(`${path}: unresolved $ref ${node.$ref}`);
        return;
      }
    }
  });

  // ------------------------------------------------ operations, roles, version
  const operationIds = new Map<string, string>();
  let v0 = 0;
  let v1 = 0;
  for (const [route, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const where = `${method.toUpperCase()} ${route}`;
      const id = op.operationId;
      if (!id) {
        fail(`${where}: missing operationId`);
        continue;
      }
      if (operationIds.has(id)) fail(`duplicate operationId \`${id}\` (${where} and ${operationIds.get(id)})`);
      operationIds.set(id, where);
      if (!/^[a-z][A-Za-z0-9]*$/.test(id)) fail(`${where}: operationId \`${id}\` is not camelCase`);
      if (!op['x-roles']) fail(`${where}: missing x-roles (deny-by-default gate)`);
      if (!op['x-version']) fail(`${where}: missing x-version`);
      if (op['x-version'] === 'V0') v0 += 1;
      if (op['x-version'] === 'V1') v1 += 1;
    }
  }

  // --------------------------------------------------------- ErrorCode casing
  const errorCodes: string[] = spec.components?.schemas?.ErrorCode?.enum ?? [];
  if (errorCodes.length === 0) fail('ErrorCode enum is missing or empty');
  for (const code of errorCodes) {
    if (typeof code !== 'string') {
      fail(`ErrorCode member is not a string: ${JSON.stringify(code)}`);
      continue;
    }
    if (code !== code.toUpperCase()) fail(`ErrorCode \`${code}\` is not SCREAMING_SNAKE_CASE`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) fail(`ErrorCode \`${code}\` has an illegal character`);
  }
  const dupes = errorCodes.filter((c, i) => errorCodes.indexOf(c) !== i);
  if (dupes.length) fail(`duplicate ErrorCode members: ${[...new Set(dupes)].join(', ')}`);

  // ------------------------------------------------------------ money invariant
  const schemas: Record<string, any> = spec.components?.schemas ?? {};
  const moneyShaped = /(^|_)(cents|amount|price|fee|total|subtotal|tip|balance)$/;
  for (const [name, schema] of Object.entries(schemas)) {
    walk(schema, `#/components/schemas/${name}`, (node, path) => {
      if (!node.properties) return;
      for (const [prop, sub] of Object.entries(node.properties as Record<string, any>)) {
        const resolved = sub.$ref?.endsWith('/Cents') ? { type: 'integer', format: 'int64' } : sub;
        if (prop.endsWith('_cents')) {
          const isInt =
            resolved.type === 'integer' ||
            (Array.isArray(resolved.type) && resolved.type.includes('integer')) ||
            sub.$ref?.endsWith('/Cents') ||
            sub.oneOf?.some((o: any) => o.$ref?.endsWith('/Cents'));
          if (!isInt) fail(`${path}/${prop}: a _cents field must be integer/int64 or $ref Cents`);
        } else if (moneyShaped.test(prop) && (resolved.type === 'number' || sub.format === 'double')) {
          fail(`${path}/${prop}: money-shaped field is number-typed`);
        }
      }
    });
  }

  // --------------------------------------------- mass-assignment (money inbound)
  for (const [route, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const body = op.requestBody?.content?.['application/json']?.schema;
      if (!body) continue;
      const bodyName: string | undefined = body.$ref?.split('/').pop();
      const target = bodyName ? schemas[bodyName] : body;
      if (!target) continue;
      walk(target, bodyName ?? `${method} ${route}`, (node) => {
        for (const prop of Object.keys(node.properties ?? {})) {
          if (!prop.endsWith('_cents')) continue;
          if (!MONEY_IN_REQUEST_ALLOWLIST.has(`${bodyName}.${prop}`)) {
            fail(
              `${method.toUpperCase()} ${route}: request body ${bodyName} carries money field \`${prop}\` ` +
                'outside the three-item allowlist',
            );
          }
        }
      });
    }
  }

  // ----------------------------- allOf bases must not close additionalProperties
  for (const [name, schema] of Object.entries(schemas)) {
    walk(schema, name, (node) => {
      if (!Array.isArray(node.allOf)) return;
      const extends_ = node.allOf.some((b: any) => b.properties);
      if (!extends_) return;
      for (const branch of node.allOf) {
        const base: string | undefined = branch.$ref?.split('/').pop();
        if (base && schemas[base]?.additionalProperties === false) {
          fail(
            `${name}: allOf base \`${base}\` sets additionalProperties:false, which makes the ` +
              'extended schema unsatisfiable — no instance can carry the added properties',
          );
        }
      }
    });
  }

  // ------------------------------------------- handover codes never reach a rider
  // The pickup and delivery codes are proof of presence that the rider types in, so no
  // response of an operation a rider can call (RIDER or PUBLIC) may carry one, however deep
  // the $ref chain. Security review on #183:
  // https://github.com/shaiknoorullah/hg-mono/issues/183 — contracts/README.md,
  // "Neither code can be bypassed".
  const HANDOVER_CODE_FIELDS = new Set(['pickup_code', 'delivery_code', 'otp_code']);
  const resolveRef = (ref: string): unknown =>
    ref
      .slice(2)
      .split('/')
      .reduce((cursor: any, part) => cursor?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
  for (const [route, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const roles: string[] = op['x-roles'] ?? [];
      if (!roles.includes('RIDER') && !roles.includes('PUBLIC')) continue;
      const followed = new Set<string>();
      const visit = (node: unknown, path: string): void => {
        walk(node, path, (n, p) => {
          for (const prop of Object.keys(n.properties ?? {})) {
            if (HANDOVER_CODE_FIELDS.has(prop)) {
              fail(
                `${method.toUpperCase()} ${route} (${op.operationId}) is callable by a rider, and ` +
                  `its response reaches \`${prop}\` at ${p}: a handover code must never reach a rider`,
              );
            }
          }
          if (typeof n.$ref === 'string' && n.$ref.startsWith('#/') && !followed.has(n.$ref)) {
            followed.add(n.$ref);
            visit(resolveRef(n.$ref), n.$ref);
          }
        });
      };
      visit(op.responses ?? {}, `${method.toUpperCase()} ${route} responses`);
    }
  }

  // ------------------------------------------------- YAML 1.1 truthy landmines
  // `ON` unquoted in a flow sequence is boolean `true` to every YAML 1.1 parser (PyYAML,
  // libyaml, Go's gopkg.in/yaml.v2) while YAML 1.2 reads it as the string "ON". Ontario is
  // the only province served at launch, so this one is not academic.
  const truthy = /(?<![\w'"-])(ON|OFF|YES|NO|Y|N|TRUE|FALSE|On|Off|Yes|No)(?![\w'"-])/;
  raw.split('\n').forEach((line, i) => {
    const flow = /^\s*(enum|examples|default):\s*\[(.+)\]\s*$/.exec(line);
    const item = /^\s*-\s+(\S+)\s*$/.exec(line);
    const candidate = flow?.[2] ?? item?.[1];
    if (candidate && truthy.test(candidate)) {
      fail(
        `contracts/openapi.yaml:${i + 1}: unquoted YAML 1.1 truthy scalar in an enum/example ` +
          `— quote it (\`${line.trim()}\`)`,
      );
    }
  });

  // ------------------------------------------------------------------- report
  console.log(`contracts/openapi.yaml`);
  console.log(`  operations       ${operationIds.size}  (V0 ${v0}, V1 ${v1})`);
  console.log(`  schemas          ${Object.keys(schemas).length}`);
  console.log(`  $refs            ${refCount}`);
  console.log(`  ErrorCode        ${errorCodes.length} members, all SCREAMING_SNAKE_CASE`);

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(`\n${problems.length} contract problem(s)`);
    return 1;
  }
  console.log('\ncontract valid');
  return 0;
}

process.exit(main());
