// Kiroween Demo (R7.1, R7.3; contract question 97): every path that compiles a Head plays the persona on a demo visit,
// whether the verified token says so (`anon:`) or, with no token at hand, the tenant's connectors do; on any other
// visit it compiles as before. The sample persona's "Riley" stands in for Jeffrey: what is checked is the wiring from
// the visit to the compile, not the pairing of fixture and visit (part C3's).
//
// The rows:
//   open      (C4's, the one private Head here): the name line on a demo visit's token; none else. A request through
//             the Route_Guard always carries the token's answer, so a demo connector under an ordinary token is not
//             a demo visit there.
//   connector visits matter on the tokenless paths only: the Parse_Repair runs after the response and asks them.
//   tap       routes/turn-tap.ts, the in-transaction compile (`withNarrowHead`) of a company tap.
//   repair    intents/repair.ts, the in-transaction compile of a late company hit, then onturn/late.ts's
//             `runRepairRoute`, whose plan compiles a Head and keeps only rules.
// The tap and the repair only ever compile a company Head there (an `alone` widens with the Head compiled before the
// transaction), and no company Head holds a name (P13), so on those rows a demo visit's result equals any other
// visit's. Their compile before the transaction is forced to miss here, so the in-transaction one runs.
import { type CoreBundle, type CoreRules, type Connector, NO_NAME_LINE, type Session, knownNameLine, tsFromMs } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it, vi } from "vitest";
import { UNKNOWN_COVERAGE } from "../bank/connector";
import { sealToken } from "../bank/seal";
import { never, ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { cFields } from "../records";
import { openRoute } from "../routes/open";
import { turnRoute } from "../routes/turn";
import { sealKeysFrom } from "../sealed";
import { paths } from "../store/paths";
import { readSnapshot } from "../store/port";
import { decisionAnswer } from "../testing/decisions";
import { BANK_TEST_KEY } from "../testing/fake-bank";
import { TEST_ENV, type TestRig, callRoute, settle, testRig } from "../testing/fakes";
import { resetAs } from "../testing/seed";
import { asrTurn, currentVisit } from "../testing/session-fixtures";
import { simToken } from "./token";
import { demoBankConnectorId, isDemoVisit } from "./visit";

const force = vi.hoisted(() => ({ fallback: false }));
vi.mock("../audience-swap", async (orig) => {
  const m = await orig<typeof import("../audience-swap")>();
  const precompileAudienceHead: typeof m.precompileAudienceHead = async (...a) => (force.fallback ? null : m.precompileAudienceHead(...a));
  return { ...m, precompileAudienceHead };
});

const UID = "owner-1";
const NAME = "Riley";
type Visit = "none" | "token" | "connector";
const VISITS: readonly Visit[] = ["none", "token", "connector"];

/** A demo visit's bank connector, as the reset writes it: a simulator token sealed under the document's own ID. */
async function writeSimBank(r: TestRig): Promise<void> {
  const id = demoBankConnectorId(r.deps.hasher, UID);
  const at = tsFromMs(r.clock.read().opsClock.now);
  const plain = simToken({ kind: "bank", fixtureId: "seed-persona-kisses-v1-00000000000000000000", worldStart: r.clock.read().worldClock.now, zone: "America/Chicago" });
  const bank: Connector = {
    ...cFields(UID, at, 1, 1),
    provider: "plaid",
    state: "connected",
    activeGeneration: 0,
    stagingGeneration: null,
    cursor: null,
    coverage: UNKNOWN_COVERAGE,
    nextPollAt: at,
    watchExpiresAt: null,
    quota: { nextAllowedAt: at, leaseUntil: null, leaseToken: null },
    lastSuccessAt: null,
    lastError: null,
    retainUntil: null,
    bank: {
      itemId: "item-sim",
      institutionId: "ins-sim",
      institutionName: "Sim Bank",
      accounts: [],
      token: sealToken(sealKeysFrom(r.deps.env, "FRANKI_BANK_TOKEN_KEY"), UID, id, plain),
      connectedAt: at,
      historicalComplete: true,
      problem: null,
      lastPullSkipped: { noCurrency: 0, badAmount: 0, badDate: 0 },
    },
    google: null,
  };
  await r.store.transaction(UID, async (tx) => tx.create(paths.connector(UID, id), bank));
}

/** The sample visit, then one open: by an anonymous token, or by an ordinary one with or without a demo connector. */
async function world(visit: Visit) {
  const r = testRig({ ...TEST_ENV, FRANKI_BANK_TOKEN_KEY: BANK_TEST_KEY });
  r.openai.always("responses.create", ok(completed("All right.")));
  r.openai.always("realtime.calls.hangup", ok(null));
  expect((await resetAs(r, UID, "v1", "r1")).status).toBe(200);
  if (visit === "connector") await writeSimBank(r);
  const token = visit === "token" ? `anon:${UID}` : `token:${UID}`;
  const res = await callRoute(r, openRoute, { requestId: testId("open1"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: await currentVisit(r) }, { token });
  expect(res.status).toBe(200);
  const deck = res.body.deck;
  const stamp = { sessionId: res.body.sessionId as string, epoch: deck.epoch, policyRev: deck.policyRev, bundleRev: deck.bundleRev, rulesRev: deck.rulesRev, generation: 1 };
  const post = (body: unknown) => settle(callRoute(r, turnRoute, body, { token }), r.clock, r.timers).then((x) => x.value);
  return { r, stamp, post };
}

const headOf = async (r: TestRig) => (await r.store.get<CoreBundle>(UID, paths.core(UID, "bundle")))!.data.head!.text;
const rulesOf = async (r: TestRig) => (await r.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
const audienceOf = async (r: TestRig, id: string) => (await r.store.get<Session>(UID, paths.session(UID, id)))!.data.audience;

function tap(stamp: Awaited<ReturnType<typeof world>>["stamp"], verb: string) {
  return {
    ...stamp,
    turnId: testId(`tap-${verb}`),
    requestId: testId(`tapreq-${verb}`),
    clientSeq: 1,
    source: "trustedTap",
    items: [],
    utteredWorldAt: "2026-11-03T12:00:00.000Z",
    transcript: "",
    transcriptState: "final",
    judge: "typed",
    pendingId: null,
    choiceId: null,
    supersedesRequestId: null,
    uiControl: { verb, targetIds: [] },
  };
}

/** Each row: what the path leaves in core/bundle's Head (and anything else it writes that a Head plan feeds). */
const ROWS: Record<string, (visit: Visit) => Promise<{ head: string; extra?: unknown }>> = {
  async open(visit) {
    force.fallback = false;
    const { r } = await world(visit);
    return { head: await headOf(r) };
  },
  async tap(visit) {
    const { r, stamp, post } = await world(visit);
    const before = await headOf(r);
    force.fallback = true;
    try {
      const res = await post(tap(stamp, "company"));
      expect(res.status).toBe(200);
    } finally {
      force.fallback = false;
    }
    expect(await audienceOf(r, stamp.sessionId)).toBe("company");
    const head = await headOf(r);
    // The in-transaction compile wrote the narrow Head.
    expect(head).not.toBe(before);
    return { head };
  },
  async repair(visit) {
    const { r, stamp, post } = await world(visit);
    // The tokenless check the repair makes: a demo visit only where the connector is.
    expect(await readSnapshot(r.store, UID, (reader) => isDemoVisit({ uid: UID, env: r.deps.env, hasher: r.deps.hasher }, reader))).toBe(visit === "connector");
    const before = await headOf(r);
    // No call is open, so a late company hit narrows with the narrow Head and no hang-up. The turn's parse misses its
    // deadline; the Parse_Repair answers the hit after the response.
    r.openai.script("decisions.create", never(), ok(decisionAnswer({ company: 0.9 })));
    force.fallback = true;
    try {
      const res = await post({ ...asrTurn(stamp, 1, "My boss just walked in.", [{ itemId: "item_a1", commitSeq: 1 }], "final", "1"), judge: "H" });
      expect(res.status).toBe(200);
      await settle(r.sched.runAll(), r.clock, r.timers);
    } finally {
      force.fallback = false;
    }
    expect(await audienceOf(r, stamp.sessionId)).toBe("company");
    const head = await headOf(r);
    expect(head).not.toBe(before);
    const rules = await rulesOf(r);
    return { head, extra: { allergies: rules.allergies, proposals: rules.proposals } };
  },
};

describe("every Head-compiling path plays the persona on a demo visit, and only then (Kiroween Demo)", () => {
  it("open: a demo visit's private Head holds the persona's name line; any other visit's holds none", async () => {
    for (const visit of VISITS) {
      const { head } = await ROWS.open!(visit);
      if (visit !== "token") {
        expect(head).toContain(NO_NAME_LINE);
        expect(head).not.toContain(NAME);
      } else {
        expect(head).toContain(knownNameLine(NAME));
        expect(head).not.toContain(NO_NAME_LINE);
      }
    }
  });

  for (const row of ["tap", "repair"] as const) {
    it(`${row}: the company Head it compiles holds no name, and a demo visit's result equals any other visit's`, async () => {
      const results = [];
      for (const visit of VISITS) results.push(await ROWS[row]!(visit));
      for (const res of results) expect(res.head).not.toContain(NAME);
      expect(results[1]).toEqual(results[0]);
      expect(results[2]).toEqual(results[0]);
    });
  }
});
