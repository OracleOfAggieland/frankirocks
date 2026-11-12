/** Test helpers for the seed (brief 019). */
import { type CoreState, type Evidence, canonicalJSON } from "@franki/core";
import { testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import { listTenantRows } from "../seed/clear";
import type { SeedFixture } from "../seed/fixture";
import { FIXTURES, PERSONA, PERSONA_FIXTURE_ID } from "../seed/persona";
import { seedResetRoute } from "../routes/seed-reset";
import { paths } from "../store/paths";
import type { StoredDoc, StorePort } from "../store/port";
import { type TestRig, callRoute } from "./fakes";

/** Zones the seed properties draw from: both hemispheres, half-hour-free and not, with and without DST. */
export const SEED_ZONES = [
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
] as const;

/** The body of a reset request, as the browser sends it. */
export function resetBody(visit: string, request: string, _zone: string, fixtureId: string = PERSONA_FIXTURE_ID) {
  return { requestId: testId(`req-${request}`), sessionId: null, fixtureId, visitId: testId(`visit-${visit}`) };
}

/** Calls POST /api/seed/reset as `uid`, after the first open would have set the zone. */
export async function resetAs(rig: TestRig, uid: string, visit: string, request: string, zone: string = "America/Chicago") {
  await ensureCoreDocs(uid, rig.deps, zone);
  return callRoute(rig, seedResetRoute, resetBody(visit, request, zone), { token: `token:${uid}` });
}

/**
 * Brief 038: calls POST /api/seed/reset the way a browser does on a visitor's first entry: no open before it, so
 * nothing has set the zone, and the zone travels in the request.
 */
export async function resetFresh(rig: TestRig, uid: string, visit: string, request: string, zone: string = "America/Chicago", fixtureId: string = PERSONA_FIXTURE_ID) {
  return callRoute(rig, seedResetRoute, resetBody(visit, request, zone, fixtureId), { token: `token:${uid}` });
}

export async function stateOf(store: StorePort, uid: string): Promise<CoreState> {
  return (await store.get<CoreState>(uid, paths.core(uid, "state")))!.data;
}

/** Every row of the tenant as `path -> canonical JSON`, sorted by path. */
export async function snapshotOf(store: StorePort, uid: string): Promise<[string, string][]> {
  const rows = await listTenantRows(store, uid);
  return rows.map((r) => [r.path, canonicalJSON(r.data)] as [string, string]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

export async function evidenceOf(store: StorePort, uid: string): Promise<StoredDoc<Evidence>[]> {
  return (await listTenantRows(store, uid)).filter((r) => r.path.includes("/evidence/")) as StoredDoc<Evidence>[];
}


/**
 * Brief 038: a Store_Port that runs `hook` before the operations it names, so a test can land another writer at an
 * exact point inside a reset (for example "when the clear first queries /memories"). The hook runs once per match
 * and never re-enters itself: the writer it runs goes straight through.
 */
export function hookedStore(
  inner: StorePort,
  when: (op: { kind: "query"; collection: string } | { kind: "transaction" }) => boolean,
  hook: () => Promise<void>,
): StorePort & { fired: number } {
  let busy = false;
  const out = {
    fired: 0,
    get: <T>(uid: string, path: string) => inner.get<T>(uid, path),
    query: async <T>(uid: string, spec: Parameters<StorePort["query"]>[1]) => {
      if (!busy && when({ kind: "query", collection: spec.collection })) await run();
      return inner.query<T>(uid, spec);
    },
    transaction: async <R>(uid: string, fn: Parameters<StorePort["transaction"]>[1] & ((tx: never) => Promise<R>)) => {
      if (!busy && when({ kind: "transaction" })) await run();
      return inner.transaction<R>(uid, fn as never);
    },
  };
  async function run() {
    busy = true;
    try {
      out.fired++;
      await hook();
    } finally {
      busy = false;
    }
  }
  return out as unknown as StorePort & { fired: number };
}

/**
 * Brief 038: a small fixture for the properties that run a whole reset per case. The same persona's first lines of
 * each kind, so a case stays cheap while every collection the reset clears and reseeds still gets rows. Registered
 * in the reset's fixture map for tests only.
 */
export const SMALL_FIXTURE_ID = "seed-small-test-fixture-0000000000000000000";
export const SMALL_FIXTURE: SeedFixture = {
  ...PERSONA,
  id: SMALL_FIXTURE_ID,
  lines: (["turn", "mail", "calendar", "bank"] as const).flatMap((k) => PERSONA.lines.filter((l) => l.kind === k).slice(0, 2)),
};
(FIXTURES as Map<string, SeedFixture>).set(SMALL_FIXTURE_ID, SMALL_FIXTURE);
