/** Reading what the API refused with, without ever branching on a message. */
import { isApiError, type HgApiError } from '@hg/api-client';

/** The stable error code, or `null` for anything that is not an API refusal (offline, timeout). */
export function errorCode(err: unknown): string | null {
  return isApiError(err) ? String(err.code) : null;
}

/** `details` when the code documents an object shape (`check_key`, `blockers`, …), else `null`. */
export function errorObject(err: HgApiError): Record<string, unknown> | null {
  const d: unknown = err.details;
  return d !== null && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
}

/** `details` when the code documents a `[{ field, code, message }]` list, else an empty list. */
export function fieldErrors(err: HgApiError): Array<{ field: string; code: string; message: string }> {
  const d: unknown = err.details;
  return Array.isArray(d) ? (d as Array<{ field: string; code: string; message: string }>) : [];
}

/** A list of strings under `details[key]`, for `blockers` and `check_keys`. */
export function stringList(err: HgApiError, key: string): string[] {
  const value = errorObject(err)?.[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
