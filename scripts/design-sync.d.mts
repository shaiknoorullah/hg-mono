/** Types for scripts/design-sync.mjs, so TypeScript tests can import it. */

export type Scheme = 'light' | 'dark';
export type Resolved = Record<Scheme, Record<string, string>>;

export interface DtcgLeaf {
  $value: unknown;
  $type?: string;
  $description?: string;
}

export interface DtcgSnapshot {
  $description?: string;
  $extensions?: Record<string, unknown>;
  color: Record<string, DtcgLeaf>;
  theme: Record<Scheme, Record<string, DtcgLeaf>>;
  font?: { family: Record<string, { $value: string[] }> };
  [group: string]: unknown;
}

export interface MalformedToken {
  name: string;
  light: string;
  dark: string;
}

export interface ParityRow {
  scheme: Scheme;
  name: string;
  live: string;
  web: string | null;
}

export interface AllowEntry {
  name: string;
  scheme?: Scheme | '*';
  kind?: 'font';
  reason: string;
}

export interface ParityResult {
  matched: number;
  allowed: Array<ParityRow & { reason: string }>;
  missing: ParityRow[];
  drift: ParityRow[];
  stale: AllowEntry[];
}

export const REPO: string;
export const SNAPSHOT_DIR: string;
export const ARTIFACT_ID: string;
export const DEFAULT_VERSION: string;
export const EXCLUDED: RegExp[];

export function normalise(live: unknown): { dtcg: DtcgSnapshot; malformed: MalformedToken[] };
export function splitStack(stack: string | string[]): string[];
export function canonical(value: unknown): string;
export function resolveSnapshot(dtcg: DtcgSnapshot): Resolved;
export function resolveGeneratedCss(css: string): Resolved;
export function compareParity(snapshot: Resolved, generated: Resolved, allowlist?: AllowEntry[]): ParityResult;
export function compareFonts(
  dtcg: DtcgSnapshot,
  css: string,
  allowlist?: AllowEntry[],
): Array<{ name: string; live: string; web: string | null; reason: string | null }>;
