// Brief 054: who counts as a demo visit when no token is at hand, and which clock a read takes.
import type { ClockPair, Connector } from "@franki/core";
import { describe, expect, it } from "vitest";
import { createHasher } from "../crypto";
import { googleConnectorId } from "../google/connector";
import { seal } from "../sealed";
import { paths } from "../store/paths";
import { BANK_TEST_KEY } from "../testing/fake-bank";
import { FAKE_HMAC_KEY } from "../testing/fakes";
import { simToken } from "./token";
import { connectorSimulated, demoBankConnectorId, isDemoVisit, readNow } from "./visit";

const hasher = createHasher(FAKE_HMAC_KEY);
const uid = "u-visit";
const env = { FRANKI_BANK_TOKEN_KEY: BANK_TEST_KEY };
const keys = { 1: Buffer.from(BANK_TEST_KEY, "base64") };
const SIM = simToken({ kind: "bank", fixtureId: "seed-persona-kisses-v1-00000000000000000000", worldStart: 1_767_254_400_000, zone: "America/Chicago" });
const REFRESH = simToken({ kind: "refresh", fixtureId: "seed-persona-kisses-v1-00000000000000000000", worldStart: 1_767_254_400_000, zone: "America/Chicago" });

const bankId = demoBankConnectorId(hasher, uid);
const gmailId = googleConnectorId(hasher, uid, "gmail");
const calendarId = googleConnectorId(hasher, uid, "calendar");

// Only the fields the check reads; the rest of a Connector is irrelevant to it.
const bankDoc = (id: string, plain: string, state = "connected", sealUid = uid): Connector =>
  ({ provider: "plaid", state, bank: { token: seal("franki-bank-token", keys, sealUid, id, plain) }, google: null }) as unknown as Connector;
const googleDoc = (id: string, provider: "gmail" | "calendar", plain: string): Connector =>
  ({ provider, state: "connected", bank: null, google: { token: seal("franki-google-token", keys, uid, id, plain) } }) as unknown as Connector;

function reader(docs: Record<string, Connector>) {
  const reads: string[] = [];
  return {
    reads,
    get: async <T,>(path: string) => {
      reads.push(path);
      const id = path.slice(path.lastIndexOf("/") + 1);
      return path in docs ? { path, id, data: docs[path] as T } : null;
    },
  };
}

describe("connectorSimulated", () => {
  it("is true for a sealed simulator token under the document's own label and ID", () => {
    expect(connectorSimulated(env, uid, { id: bankId, data: bankDoc(bankId, SIM) })).toBe(true);
    expect(connectorSimulated(env, uid, { id: gmailId, data: googleDoc(gmailId, "gmail", REFRESH) })).toBe(true);
  });

  it("is false for a live token, a malformed marker, a disconnected document, another record's seal or no key", () => {
    expect(connectorSimulated(env, uid, { id: bankId, data: bankDoc(bankId, "access-sandbox-0000") })).toBe(false);
    expect(connectorSimulated(env, uid, { id: bankId, data: bankDoc(bankId, "fsim1~bank~short") })).toBe(false);
    expect(connectorSimulated(env, uid, { id: bankId, data: bankDoc(bankId, SIM, "disconnected") })).toBe(false);
    expect(connectorSimulated(env, uid, { id: bankId, data: bankDoc("other-id", SIM) })).toBe(false);
    expect(connectorSimulated(env, uid, { id: bankId, data: bankDoc(bankId, SIM, "connected", "someone-else") })).toBe(false);
    expect(connectorSimulated({}, uid, { id: bankId, data: bankDoc(bankId, SIM) })).toBe(false);
  });
});

describe("isDemoVisit", () => {
  it("takes the token's answer when there is one, and opens no connector for it", async () => {
    const r = reader({ [paths.connector(uid, bankId)]: bankDoc(bankId, SIM) });
    expect(await isDemoVisit({ uid, anonymous: false, env, hasher }, r)).toBe(false);
    expect(await isDemoVisit({ uid, anonymous: true, env, hasher }, r)).toBe(true);
    expect(r.reads).toEqual([]);
  });

  it("asks the three fixed documents when no token decided, at most three reads", async () => {
    const none = reader({});
    expect(await isDemoVisit({ uid, env, hasher }, none)).toBe(false);
    expect(none.reads.sort()).toEqual([bankId, gmailId, calendarId].map((id) => paths.connector(uid, id)).sort());

    const live = reader({ [paths.connector(uid, bankId)]: bankDoc(bankId, "access-sandbox-0000") });
    expect(await isDemoVisit({ uid, env, hasher }, live)).toBe(false);

    for (const [id, doc] of [
      [bankId, bankDoc(bankId, SIM)],
      [gmailId, googleDoc(gmailId, "gmail", REFRESH)],
      [calendarId, googleDoc(calendarId, "calendar", REFRESH)],
    ] as const) {
      expect(await isDemoVisit({ uid, env, hasher }, reader({ [paths.connector(uid, id)]: doc }))).toBe(true);
    }
  });
});

describe("readNow", () => {
  const pair: ClockPair = { worldClock: { now: 100, zone: "UTC" }, opsClock: { now: 900 } };
  it("is the world clock on a demo visit and the ops clock otherwise", () => {
    expect(readNow(pair, true)).toBe(100);
    expect(readNow(pair, false)).toBe(900);
  });
});
