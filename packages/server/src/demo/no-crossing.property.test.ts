/**
 * No crossing (brief 054 design, correctness property 3; R10.2, R10.3, R10.5, R10.6, R10.9). 1,000 runs.
 *   FOR ALL sequences of calls to `routingBank` and `routingGoogle`, with tokens drawn from simulator tokens (every
 *   kind), live-shaped tokens (`access-sandbox-…`, `1//…`, `ya29.…`, anything without the marker) and strings with
 *   the marker that do not parse:
 *   a call whose token reads as a simulator token reaches only the simulator, a call whose token has no marker
 *   reaches only the live port, and a call whose token is malformed reaches neither and throws a definite refusal.
 *   AND a call that carries no token (`linkToken`, `exchange`, `exchangeCode`) reaches only the live port.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BankConfig } from "../bank/config";
import { BankCallError, type BankPort } from "../bank/plaid";
import type { GoogleConfig } from "../google/config";
import { GoogleCallError, type GooglePort } from "../google/port";
import { SEED_ZONES } from "../testing/seed";
import { routingBank, routingGoogle } from "./routing";
import { SIM_KINDS, SIM_PREFIX, readSimToken, simToken } from "./token";

const RUNS = { numRuns: 1000 };
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-".split("");
const fixtureId = fc.array(fc.constantFrom(...ID_CHARS), { minLength: 43, maxLength: 43 }).map((a) => a.join(""));

const simTok = fc
  .record({ kind: fc.constantFrom(...SIM_KINDS), fixtureId, worldStart: fc.integer({ min: 0, max: 999_999_999_999_999 }), zone: fc.constantFrom(...SEED_ZONES) })
  .map((t) => simToken(t));
const live = fc.oneof(
  fc.string({ maxLength: 80 }).map((s) => `access-sandbox-${s}`),
  fc.string({ maxLength: 80 }).map((s) => `access-production-${s}`),
  fc.string({ maxLength: 80 }).map((s) => `1//${s}`),
  fc.string({ maxLength: 80 }).map((s) => `ya29.${s}`),
  fc.string({ maxLength: 120 }).filter((s) => !s.startsWith(SIM_PREFIX)),
);
const malformed = fc
  .oneof(
    fc.string({ maxLength: 120 }).map((s) => SIM_PREFIX + s),
    fc.tuple(simTok, fc.string({ minLength: 1, maxLength: 4 })).map(([t, s]) => t + s),
    simTok.map((t) => t.slice(0, t.length - 1)),
  )
  .filter((s) => readSimToken(s) === "malformed");
const token = fc.oneof(simTok, live, malformed);

const BANK_METHODS = ["linkToken", "exchange", "accounts", "sync", "remove"] as const;
const GOOGLE_METHODS = ["exchangeCode", "refresh", "revoke", "listMessages", "getMessage", "listEvents"] as const;
type BankMethod = (typeof BANK_METHODS)[number];
type GoogleMethod = (typeof GOOGLE_METHODS)[number];
const TOKENLESS = new Set<string>(["linkToken", "exchange", "exchangeCode"]);

const call = fc.oneof(
  fc.record({ port: fc.constant("bank" as const), method: fc.constantFrom(...BANK_METHODS), token }),
  fc.record({ port: fc.constant("google" as const), method: fc.constantFrom(...GOOGLE_METHODS), token }),
);

const bankConfig = {} as BankConfig;
const googleConfig = {} as GoogleConfig;

/** A port that answers nothing useful and records every call it receives, with the token it was given. */
function recordingBank(log: { method: string; token: string | null }[]): BankPort {
  return {
    linkToken: async () => (log.push({ method: "linkToken", token: null }), { linkToken: "l", expiration: "e" }),
    exchange: async () => (log.push({ method: "exchange", token: null }), { accessToken: "a", itemId: "i" }),
    accounts: async (_c, t) => (log.push({ method: "accounts", token: t }), { itemId: "i", institutionId: null, institutionName: null, accounts: [] }),
    sync: async (_c, t) => (log.push({ method: "sync", token: t }), { added: [], modified: [], removed: [], accounts: [], nextCursor: "c", hasMore: false, updateStatus: "HISTORICAL_UPDATE_COMPLETE" }),
    remove: async (_c, t) => void log.push({ method: "remove", token: t }),
  };
}

function recordingGoogle(log: { method: string; token: string | null }[]): GooglePort {
  return {
    exchangeCode: async () => (log.push({ method: "exchangeCode", token: null }), { accessToken: "a", refreshToken: null, scope: [], idToken: null }),
    refresh: async (_c, t) => (log.push({ method: "refresh", token: t }), { accessToken: "a", scope: null }),
    revoke: async (t) => void log.push({ method: "revoke", token: t }),
    listMessages: async (t) => (log.push({ method: "listMessages", token: t }), []),
    getMessage: async (t, id) => (log.push({ method: "getMessage", token: t }), { id, threadId: id, internalDate: null, labelIds: [], payload: null }),
    listEvents: async (t) => (log.push({ method: "listEvents", token: t }), { timeZone: null, items: [], nextPageToken: null }),
  };
}

function bankCall(p: BankPort, method: BankMethod, t: string): Promise<unknown> {
  switch (method) {
    case "linkToken":
      return p.linkToken(bankConfig, t);
    case "exchange":
      return p.exchange(bankConfig, t);
    case "accounts":
      return p.accounts(bankConfig, t);
    case "sync":
      return p.sync(bankConfig, t, null);
    case "remove":
      return p.remove(bankConfig, t);
  }
}

function googleCall(p: GooglePort, method: GoogleMethod, t: string): Promise<unknown> {
  switch (method) {
    case "exchangeCode":
      return p.exchangeCode(googleConfig, { code: t, verifier: "v".repeat(43), redirectUri: "http://localhost/google/callback" });
    case "refresh":
      return p.refresh(googleConfig, t);
    case "revoke":
      return p.revoke(t);
    case "listMessages":
      return p.listMessages(t, "in:sent", 1);
    case "getMessage":
      return p.getMessage(t, "m0000");
    case "listEvents":
      return p.listEvents(t, { timeMin: "2026-01-01T00:00:00Z", timeMax: "2026-01-02T00:00:00Z", max: 10 });
  }
}

describe("routing ports: a token never crosses to the other side", () => {
  it("sends each call to the simulator, the live port or neither, by its token alone", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(call, { minLength: 1, maxLength: 20 }), async (calls) => {
        const liveBank: { method: string; token: string | null }[] = [];
        const simBank: { method: string; token: string | null }[] = [];
        const liveGoogle: { method: string; token: string | null }[] = [];
        const simGoogle: { method: string; token: string | null }[] = [];
        const bank = routingBank(recordingBank(liveBank), recordingBank(simBank));
        const google = routingGoogle(recordingGoogle(liveGoogle), recordingGoogle(simGoogle));
        for (const c of calls) {
          const before = [liveBank.length, simBank.length, liveGoogle.length, simGoogle.length];
          const read = TOKENLESS.has(c.method) ? null : readSimToken(c.token);
          let thrown: unknown = null;
          try {
            await (c.port === "bank" ? bankCall(bank, c.method as BankMethod, c.token) : googleCall(google, c.method as GoogleMethod, c.token));
          } catch (e) {
            thrown = e;
          }
          const after = [liveBank.length, simBank.length, liveGoogle.length, simGoogle.length];
          const [liveIx, simIx] = c.port === "bank" ? [0, 1] : [2, 3];
          const reachedLive = after[liveIx]! - before[liveIx]!;
          const reachedSim = after[simIx]! - before[simIx]!;
          // The other port family is never touched by this call.
          const otherIx = c.port === "bank" ? [2, 3] : [0, 1];
          for (const i of otherIx) expect(after[i]).toBe(before[i]);
          if (read === "malformed") {
            expect(reachedLive + reachedSim).toBe(0);
            if (c.port === "bank") {
              expect(thrown).toBeInstanceOf(BankCallError);
              expect((thrown as BankCallError).definite).toBe(true);
            } else {
              expect(thrown).toBeInstanceOf(GoogleCallError);
              expect((thrown as GoogleCallError).problem).toBe("refused");
              expect((thrown as GoogleCallError).definite).toBe(true);
            }
          } else if (read === null) {
            expect(thrown).toBeNull();
            expect([reachedLive, reachedSim]).toEqual([1, 0]);
          } else {
            expect(thrown).toBeNull();
            expect([reachedLive, reachedSim]).toEqual([0, 1]);
          }
        }
        // Over the whole sequence: no simulator token reached a live port, no other token reached a simulator.
        for (const r of [...liveBank, ...liveGoogle]) if (r.token !== null) expect(readSimToken(r.token)).toBeNull();
        for (const r of [...simBank, ...simGoogle]) expect(typeof readSimToken(r.token!)).toBe("object");
        for (const r of [...simBank, ...simGoogle]) expect(readSimToken(r.token!)).not.toBeNull();
      }),
      RUNS,
    );
  });
});
