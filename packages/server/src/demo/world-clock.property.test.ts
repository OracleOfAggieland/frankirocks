/**
 * The world clock decides by token, then by connector (brief 054 design, correctness property 12; R4.8, R28.1,
 * R28.2, R28.3, R28.5). 1,000 runs.
 *   FOR ALL `anonymous` (true, false, absent) and ALL sets of the tenant's three fixed connector documents (each
 *   simulated, live, sealed under another document's ID, disconnected, or missing), with the token key set or not:
 *   `isDemoVisit` is `anonymous` when it is defined and then opens no connector at all; otherwise it is true exactly
 *   when some document unseals to a simulator token; and `readNow` is the world clock exactly when it is true.
 * The money read and the Google agents take their "now" from these two (`bank/money-read.ts`,
 * `errands/google-agents.ts`); the end-to-end test checks the answers that follow from it.
 */
import { type Connector, type SealedToken, createFakeClock, tsFromMs } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BANK_ENV_VARS } from "../bank/config";
import { UNKNOWN_COVERAGE } from "../bank/connector";
import { createHasher } from "../crypto";
import { type GoogleProvider, googleAccountKey, googleConnectorId, newGoogleConnector } from "../google/connector";
import { cFields } from "../records";
import { sealKeysFrom, seal } from "../sealed";
import { KISSES_FIXTURE_ID } from "../seed/kisses";
import { paths } from "../store/paths";
import { BANK_TEST_KEY } from "../testing/fake-bank";
import { FAKE_HMAC_KEY, T0_MS } from "../testing/fakes";
import { SEED_ZONES } from "../testing/seed";
import { SIM_KINDS, simToken } from "./token";
import { demoBankConnectorId, isDemoVisit, readNow } from "./visit";

const RUNS = { numRuns: 1000 };
const UID = "visitor-1";
const hasher = createHasher(FAKE_HMAC_KEY);
const KEY_ENV = { [BANK_ENV_VARS.tokenKey]: BANK_TEST_KEY };

type DocKind = "simulated" | "live" | "malformed" | "otherId" | "disconnected" | "missing";
const docKind = fc.constantFrom<DocKind>("simulated", "live", "malformed", "otherId", "disconnected", "missing");

const LIVE_TOKENS = ["access-sandbox-6f1c0a2e-0000-4000-8000-1234567890ab", "1//0gTESTREFRESHtoken-AbCdEfGh", "ya29.a0TESTaccess-token_0123"];

function bankDoc(token: SealedToken, state: Connector["state"]): Connector {
  const at = tsFromMs(T0_MS);
  return {
    ...cFields(UID, at, 1, 1),
    provider: "plaid",
    state,
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
    bank: { itemId: "item-1", institutionId: null, institutionName: null, accounts: [], token, connectedAt: at, historicalComplete: true, problem: null, lastPullSkipped: { noCurrency: 0, badAmount: 0, badDate: 0 } },
    google: null,
  };
}

function googleDoc(provider: GoogleProvider, token: SealedToken, state: Connector["state"]): Connector {
  return {
    ...newGoogleConnector(UID, provider, T0_MS, { epoch: 1, policyRev: 1 }),
    state,
    google: { accountKey: googleAccountKey(hasher, UID, "sub"), email: "a@b.example", granted: true, token, connectedAt: tsFromMs(T0_MS), pending: null },
  };
}

/** The plain token a document of this kind holds, and the ID its seal is bound to. */
function plainOf(kind: DocKind, slot: "bank" | GoogleProvider, id: string, sim: { worldStart: number; zone: string; kindIndex: number }, liveIndex: number): { plain: string; sealId: string } {
  const simKind = slot === "bank" ? "bank" : SIM_KINDS[sim.kindIndex % SIM_KINDS.length]!;
  const good = simToken({ kind: simKind, fixtureId: KISSES_FIXTURE_ID, worldStart: sim.worldStart, zone: sim.zone });
  if (kind === "live") return { plain: LIVE_TOKENS[liveIndex % LIVE_TOKENS.length]!, sealId: id };
  if (kind === "malformed") return { plain: `fsim1~${simKind}~not-a-fixture`, sealId: id };
  if (kind === "otherId") return { plain: good, sealId: `${id}-elsewhere` };
  return { plain: good, sealId: id };
}

describe("a demo visit's clock", () => {
  it("follows the verified token when there is one, and the connectors only when there is none", async () => {
    const keys = sealKeysFrom(KEY_ENV, BANK_ENV_VARS.tokenKey);
    const ids = { bank: demoBankConnectorId(hasher, UID), gmail: googleConnectorId(hasher, UID, "gmail"), calendar: googleConnectorId(hasher, UID, "calendar") };
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(true, false, undefined),
        fc.record({ bank: docKind, gmail: docKind, calendar: docKind }),
        fc.boolean(),
        fc.record({ worldStart: fc.integer({ min: 0, max: 4_000_000_000_000 }), zone: fc.constantFrom(...SEED_ZONES), kindIndex: fc.nat(), liveIndex: fc.nat() }),
        fc.record({ world: fc.integer({ min: 0, max: 4_000_000_000_000 }), ops: fc.integer({ min: 0, max: 4_000_000_000_000 }) }),
        async (anonymous, kinds, keySet, sim, clocks) => {
          const docs = new Map<string, Connector>();
          for (const slot of ["bank", "gmail", "calendar"] as const) {
            const kind = kinds[slot];
            if (kind === "missing") continue;
            const id = ids[slot];
            const { plain, sealId } = plainOf(kind, slot, id, sim, sim.liveIndex);
            const label = slot === "bank" ? "franki-bank-token" : "franki-google-token";
            const sealed = seal(label, keys, UID, sealId, plain);
            const state = kind === "disconnected" ? "disconnected" : "connected";
            docs.set(paths.connector(UID, id), slot === "bank" ? bankDoc(sealed, state) : googleDoc(slot, sealed, state));
          }
          let reads = 0;
          const reader = {
            get: async <T>(path: string) => {
              reads++;
              const d = docs.get(path);
              return d === undefined ? null : ({ id: path.split("/").at(-1)!, path, data: d as unknown as T } as never);
            },
          };
          const env = keySet ? KEY_ENV : {};
          const demo = await isDemoVisit({ uid: UID, anonymous, env, hasher }, reader);

          if (anonymous !== undefined) {
            expect(demo).toBe(anonymous);
            expect(reads).toBe(0);
          } else {
            const expected = keySet && Object.values(kinds).some((k) => k === "simulated");
            expect(demo).toBe(expected);
            expect(reads).toBeLessThanOrEqual(3);
          }

          const pair = createFakeClock({ world: clocks.world, ops: clocks.ops, zone: "UTC" }).read();
          expect(readNow(pair, demo)).toBe(demo ? pair.worldClock.now : pair.opsClock.now);
        },
      ),
      RUNS,
    );
  }, 600_000);
});
