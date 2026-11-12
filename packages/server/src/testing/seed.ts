/** Test helpers for the seed (brief 019). */
import { type CoreState, type Evidence, canonicalJSON } from "@franki/core";
import { testId } from "@franki/core/testing";
import { ensureCoreDocs } from "../core-docs";
import { listTenantRows } from "../seed/clear";
import { PERSONA_FIXTURE_ID } from "../seed/persona";
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

/** Calls POST /api/seed/reset as `uid`, after the first open would have set the zone. */
export async function resetAs(rig: TestRig, uid: string, visit: string, request: string, zone: string = "America/Chicago") {
  await ensureCoreDocs(uid, rig.deps, zone);
  return callRoute(
    rig,
    seedResetRoute,
    { requestId: testId(`req-${request}`), sessionId: null, fixtureId: PERSONA_FIXTURE_ID, visitId: testId(`visit-${visit}`) },
    { token: `token:${uid}` },
  );
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

