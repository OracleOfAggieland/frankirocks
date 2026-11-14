/** Brief 049: a route rig with the fake Google port and Google's settings. */
import { testId } from "@franki/core/testing";
import { googleConnectRoute, googleStartRoute } from "../google/routes";
import { FakeGoogle, GOOGLE_TEST_ENV } from "./fake-google";
import { TEST_ENV, callRoute, testRig } from "./fakes";

export const OWNER = "owner-1";
export const OTHER = "owner-2";

export function googleRig(env: Record<string, string> = { ...TEST_ENV, ...GOOGLE_TEST_ENV }) {
  const rig = testRig(env);
  const google = new FakeGoogle();
  rig.deps.google = google;
  return { rig, google };
}

/** The state inside a start answer's authorization URL. */
export function stateOf(url: string): string {
  const s = new URL(url).searchParams.get("state");
  if (s === null) throw new Error("no state in the authorization URL");
  return s;
}

/** Starts and connects through the routes, the way the popup does. */
export async function connectGoogleVia(rig: ReturnType<typeof testRig>, n: number | string = 1, uid = OWNER) {
  const start = await callRoute(rig, googleStartRoute, {}, { token: `token:${uid}` });
  if (start.status !== 200) return start;
  return callRoute(rig, googleConnectRoute, { requestId: testId(`google-connect-${n}`), code: "4/0AQSTgQ-test-code", state: stateOf(start.body.url) }, { token: `token:${uid}` });
}
