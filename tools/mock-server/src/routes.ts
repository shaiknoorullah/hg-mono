/**
 * Route table built from `contracts/openapi.yaml`.
 *
 * Every operation in the document gets a route, so a frontend calling an endpoint nobody
 * has implemented gets a fixture instead of a connection error — and calling one that is
 * *not* in the contract gets a 404 with `NOT_FOUND`, which is the point.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { CONTRACT } from './fixtures.js';

export interface Route {
  operationId: string;
  method: string;
  /** OpenAPI path template, e.g. `/v1/orders/{orderId}`. */
  template: string;
  /** Full path including the server base path. */
  fullPath: string;
  regexp: RegExp;
  paramNames: string[];
  version: string;
  roles: string[];
  successStatus: number;
  /** `true` when the 2xx response has no body (204). */
  noContent: boolean;
  /** `true` when the 2xx `data` is an array (so `meta` is required). */
  isCollection: boolean;
  requiresIdempotencyKey: boolean;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function toRegexp(path: string): { regexp: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const source = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { regexp: new RegExp(`^${source}$`), paramNames };
}

export function loadRoutes(): { routes: Route[]; basePath: string; spec: any } {
  const spec = parseYaml(readFileSync(CONTRACT, 'utf8')) as any;

  // The contract's `servers[0].url` carries the base path (`/v1`); `/health` and
  // `/health/ready` sit outside it, and their path keys already say so.
  const serverUrl: string = spec.servers?.[0]?.url ?? '';
  let basePath = '';
  try {
    basePath = new URL(serverUrl).pathname.replace(/\/$/, '');
  } catch {
    basePath = serverUrl.startsWith('/') ? serverUrl.replace(/\/$/, '') : '';
  }

  const routes: Route[] = [];
  for (const [template, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!HTTP_METHODS.includes(method)) continue;

      // Paths that already start with the base path are absolute; the rest hang off it.
      const fullPath = template.startsWith(basePath) ? template : `${basePath}${template}`;
      const { regexp, paramNames } = toRegexp(fullPath);

      const successCode = Object.keys(op.responses ?? {})
        .filter((c) => /^2\d\d$/.test(c))
        .sort()[0];
      const successStatus = successCode ? Number(successCode) : 200;
      const success = op.responses?.[successCode ?? '200'];
      const jsonSchema = success?.content?.['application/json']?.schema;
      const dataSchema = jsonSchema?.properties?.data;

      routes.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        template,
        fullPath,
        regexp,
        paramNames,
        version: op['x-version'] ?? 'V0',
        roles: op['x-roles'] ?? [],
        successStatus,
        noContent: successStatus === 204 || !jsonSchema,
        isCollection: dataSchema?.type === 'array',
        requiresIdempotencyKey: (op.parameters ?? []).some(
          (p: any) => p?.name === 'Idempotency-Key' && p?.required === true,
        ),
      });
    }
  }

  // Longer, more literal templates first so `/v1/orders/active` beats `/v1/orders/{orderId}`.
  routes.sort((a, b) => {
    const aVars = (a.fullPath.match(/\{/g) ?? []).length;
    const bVars = (b.fullPath.match(/\{/g) ?? []).length;
    if (aVars !== bVars) return aVars - bVars;
    return b.fullPath.length - a.fullPath.length;
  });

  return { routes, basePath, spec };
}

export function matchRoute(routes: Route[], method: string, path: string): Route | undefined {
  return routes.find((r) => r.method === method && r.regexp.test(path));
}
