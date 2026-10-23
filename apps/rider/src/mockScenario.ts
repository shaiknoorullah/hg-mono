/**
 * The mock scenario the API clients send as `X-Mock-Scenario`, read on every request.
 *
 * Nothing sets it in a normal build, and a real API ignores the header. The capture entry
 * (`redesign/capture/`, only in a build with `EXPO_PUBLIC_HG_CAPTURE=1`) sets it to put a screen
 * into the state a design board draws, against `pnpm mock`. A scenario is a name, or a
 * per-operation map such as `getRiderMe=rider_me_active,refreshSession=error_session_revoked`
 * (tools/mock-server/README.md, "Picking a state").
 */
let scenario: string | undefined;

export function getMockScenario(): string | undefined {
  return scenario;
}

/** `undefined` (or an empty string) clears it. */
export function setMockScenario(next: string | undefined): void {
  scenario = next || undefined;
}
