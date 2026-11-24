/**
 * The connectors at seed (brief 054 ruling 7; R11). A demo visit arrives with its bank, Gmail and Calendar already
 * connected: the reset writes the three existing connector records, each holding, sealed under the same key and
 * labels as a real connection, a simulator token that names the fixture and this visit's world start and zone. The
 * routing ports then send every call on those tokens to the simulators, so everything above the port is the real
 * product (the pull, the import, `read_money`, the Google reads).
 *
 * Called by `resetVisit` only, for a fixture with a `demo` profile. Start over calls it again with the new visit's
 * world start and zone, so no token of an earlier visit stays (R11.5); the documents keep their IDs (functions of the
 * owner), `createdAt` and `activeGeneration` (contract question 102).
 */
import { type Connector, type Hasher, tsFromMs } from "@franki/core";
import { UNKNOWN_COVERAGE } from "../bank/connector";
import { sealToken } from "../bank/seal";
import type { Env } from "../config/env";
import { type GoogleProvider, googleAccountKey, googleConnectorId, newGoogleConnector } from "../google/connector";
import { cFields } from "../records";
import { type SealKeys, seal } from "../sealed";
import type { SeedFixture } from "../seed/fixture";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { simToken } from "./token";
import { connectorSimulated, demoBankConnectorId } from "./visit";

export interface DemoInstallInput {
  uid: string;
  hasher: Hasher;
  /** A fixture whose `demo` is defined. */
  fixture: SeedFixture;
  keys: SealKeys;
  worldStart: number;
  zone: string;
  opsNow: number;
  core: { epoch: number; policyRev: number };
}

export interface DemoConnectors {
  bank: { id: string; data: Connector };
  gmail: { id: string; data: Connector };
  calendar: { id: string; data: Connector };
}

/** Pure apart from the random IV of each seal. Throws when the fixture has no demo profile. */
export function buildDemoConnectors(x: DemoInstallInput): DemoConnectors {
  const demo = x.fixture.demo;
  if (demo === undefined) throw new Error("buildDemoConnectors: the fixture has no demo profile");
  const at = tsFromMs(x.opsNow);
  const token = (kind: "bank" | "refresh") => simToken({ kind, fixtureId: x.fixture.id, worldStart: x.worldStart, zone: x.zone });

  const bankId = demoBankConnectorId(x.hasher, x.uid);
  const bank: Connector = {
    ...cFields(x.uid, at, x.core.epoch, x.core.policyRev),
    provider: "plaid",
    state: "connected",
    activeGeneration: 0,
    stagingGeneration: null,
    cursor: null,
    coverage: UNKNOWN_COVERAGE,
    nextPollAt: at,
    watchExpiresAt: null,
    quota: { nextAllowedAt: at, leaseUntil: null, leaseToken: null },
    // Never read: the first money read finds it stale and pulls, so the rows arrive through the real pull (R11.7).
    lastSuccessAt: null,
    lastError: null,
    retainUntil: null,
    bank: {
      itemId: demo.bank.itemId,
      institutionId: demo.bank.institutionId,
      institutionName: demo.bank.institutionName,
      accounts: demo.bank.accounts.map((a) => ({ accountId: a.accountId, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype })),
      token: sealToken(x.keys, x.uid, bankId, token("bank")),
      connectedAt: at,
      // The sheet shows a connected bank with its accounts, not one still importing.
      historicalComplete: true,
      problem: null,
      lastPullSkipped: { noCurrency: 0, badAmount: 0, badDate: 0 },
    },
    google: null,
  };

  const google = (provider: GoogleProvider): { id: string; data: Connector } => {
    const id = googleConnectorId(x.hasher, x.uid, provider);
    const base = newGoogleConnector(x.uid, provider, x.opsNow, x.core);
    return {
      id,
      data: {
        ...base,
        state: "connected",
        google: {
          // Keyed to the fixture, never to a real Google account, so a simulated account's rows meet no real one's.
          accountKey: googleAccountKey(x.hasher, x.uid, `sim:${x.fixture.id}`),
          email: demo.google.email,
          granted: true,
          token: seal("franki-google-token", x.keys, x.uid, id, token("refresh")),
          connectedAt: at,
          pending: null,
        },
      },
    };
  };

  return { bank: { id: bankId, data: bank }, gmail: google("gmail"), calendar: google("calendar") };
}

/**
 * Writes the three documents inside the reset's last transaction (R11.1, R11.8). A document already there (an
 * earlier visit of this tenant) is replaced, keeping its `createdAt` and `activeGeneration`; the store raises `rev`.
 */
export async function writeDemoConnectors(tx: Tx, uid: string, docs: DemoConnectors): Promise<void> {
  const all = [docs.bank, docs.gmail, docs.calendar];
  const prior = await Promise.all(all.map((d) => tx.get<Connector>(paths.connector(uid, d.id))));
  all.forEach((d, i) => {
    const p = prior[i];
    const path = paths.connector(uid, d.id);
    if (p === null || p === undefined) tx.create(path, d.data);
    else tx.update(path, { ...d.data, createdAt: p.data.createdAt, activeGeneration: p.data.activeGeneration });
  });
}

/**
 * A tenant that is not a demo visit keeps no simulated connector. A demo visitor can link a real sign-in to the
 * anonymous user by hand: the uid stays, every later token is a signed-in one, and pairing gives the next Start over
 * the sample fixture. That reset calls this in its last transaction, so the sample visit never answers from the
 * persona's bank, Gmail or Calendar.
 *
 * Only the three fixed documents are read, and only one whose sealed token is a simulator token is deleted, so a real
 * Google connection under the same document ID is left alone. Returns the deleted paths: the caller keeps its other
 * writes off them, since a path may not be both written and deleted in one transaction.
 */
export async function dropSimulatedConnectors(tx: Tx, uid: string, env: Env, hasher: Hasher): Promise<Set<string>> {
  const ids = [demoBankConnectorId(hasher, uid), googleConnectorId(hasher, uid, "gmail"), googleConnectorId(hasher, uid, "calendar")];
  const docs = await Promise.all(ids.map((id) => tx.get<Connector>(paths.connector(uid, id))));
  const dropped = new Set<string>();
  docs.forEach((doc, i) => {
    const id = ids[i]!;
    if (doc === null || !connectorSimulated(env, uid, { id, data: doc.data })) return;
    const path = paths.connector(uid, id);
    tx.delete(path);
    dropped.add(path);
  });
  return dropped;
}
