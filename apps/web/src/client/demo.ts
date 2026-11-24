/**
 * The Kiroween Demo in the browser (brief 054): the persona's fixture ID and name, the marker the landing's button
 * links to, and the one read of the switch. The browser can't import server code, so the ID and the name are held
 * here as literals; `scripts/kisses-fixture-id.test.ts` fails if either differs from the fixture's own.
 */
import { DEMO_HASH } from "../ui/demo/marker";

export { DEMO_HASH };

/** The reset's `fixtureId` for a demo visit (the server's `KISSES_FIXTURE_ID`). */
export const KISSES_FIXTURE_ID = "seed-persona-kisses-v1-00000000000000000000";
/** The persona's name, shown where a signed-in visit shows the email (the fixture's `demo.displayName`). */
export const DEMO_NAME = "Jeffrey Kisses";
/** Where the landing's Kiroween Demo button goes. The fragment never reaches the server. */
export const DEMO_HREF = `/lab${DEMO_HASH}`;
/** The switch's one unauthenticated route (R15.8). */
export const DEMO_PATH = "/api/demo";
/** The switch's answer is one small read; past this the button stays hidden. */
export const DEMO_TIMEOUT_MS = 6_000;

export const hasDemoMarker = (hash: string): boolean => hash === DEMO_HASH;

/** True only for exactly `{ "enabled": true }`: one key, a boolean, nothing else (the route's closed answer). */
export function demoAnswerEnabled(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "enabled" && (body as { enabled: unknown }).enabled === true;
}

/**
 * GET /api/demo. true only for { enabled: true } as the closed shape; any failure or other answer is false. The
 * button renders nothing until this has answered true (R1.3), so a slow, failed or odd answer hides it.
 */
export async function fetchDemoEnabled(fetchFn: (input: string, init: RequestInit) => Promise<Response>): Promise<boolean> {
  const ctl = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = ctl === null ? null : setTimeout(() => ctl.abort(), DEMO_TIMEOUT_MS);
  try {
    const res = await fetchFn(DEMO_PATH, { method: "GET", cache: "no-store", credentials: "omit", ...(ctl === null ? {} : { signal: ctl.signal }) });
    if (!res.ok) return false;
    return demoAnswerEnabled(await res.json());
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
