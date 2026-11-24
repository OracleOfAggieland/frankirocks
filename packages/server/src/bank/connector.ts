/**
 * Brief 046: the stored bank connection (`connectors/{connectorId}`, ruling 3), what the screen may see of it
 * (`BankView`), and the reset's hook (ruling 9).
 */
import {
  BANK_LIMIT,
  type BankView,
  type Connector,
  type Cov,
  type Hasher,
  SAFE_NAME_FALLBACK,
  safeName,
  tsFromMs,
  withConnectorDefaults,
} from "@franki/core";
import { paths } from "../store/paths";
import type { Reader, StoredDoc, Tx } from "../store/port";

export const UNKNOWN_COVERAGE: Cov = { state: "unknown", from: null, to: null, missingRanges: [], generation: 0 };

export const connectorIdFor = (hasher: Hasher, uid: string, requestId: string) => hasher.id(["bank-connector", uid, requestId]);
/** The stable, hashed `client_user_id` a link token carries (never the uid itself). */
export const clientUserIdFor = (hasher: Hasher, uid: string) => hasher.id(["bank-user", uid]);

/** Reads a stored connector with defaults filled (record-shape rule). */
export function readConnector(raw: unknown): Connector {
  return withConnectorDefaults(raw as Parameters<typeof withConnectorDefaults>[0]);
}

export async function getConnector(reader: Pick<Reader, "get">, uid: string, connectorId: string): Promise<StoredDoc<Connector> | null> {
  const doc = await reader.get(paths.connector(uid, connectorId));
  return doc === null ? null : { ...doc, data: readConnector(doc.data) };
}

/** Every connector of the owner (Q28; there are at most a handful). */
export async function listConnectors(reader: Pick<Reader, "query">, uid: string): Promise<StoredDoc<Connector>[]> {
  const out: StoredDoc<Connector>[] = [];
  let after: string | null = null;
  for (;;) {
    const page: StoredDoc[] = await reader.query({
      collection: paths.collection(uid, "connectors"),
      where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    out.push(...page.map((d) => ({ ...d, data: readConnector(d.data) })));
    if (page.length < 100) return out;
    after = page[page.length - 1]!.id;
  }
}

/** A bank connection that counts against the limit: anything but disconnected. */
export const isActiveBank = (c: Connector) => c.provider === "plaid" && c.bank !== null && c.state !== "disconnected";
export const activeBankCount = (cs: readonly StoredDoc<Connector>[]) => cs.filter((c) => isActiveBank(c.data)).length;
export const canConnectMore = (cs: readonly StoredDoc<Connector>[]) => activeBankCount(cs) < BANK_LIMIT;

/** A display name, or null when it would not pass `safeName`. The bank's words are data, shown only as a name. */
function displayName(name: string | null): string | null {
  if (name === null) return null;
  const safe = safeName(name);
  return safe === SAFE_NAME_FALLBACK ? null : safe;
}

/** What the screen may show of one connector: no balances, no token, no Plaid IDs. */
export function bankView(id: string, c: Connector): BankView {
  const bank = c.bank;
  const live = c.state !== "disconnected";
  return {
    connectorId: id,
    institutionName: displayName(bank?.institutionName ?? null),
    state: c.state,
    importing: live && c.state !== "expired" && bank !== null && !bank.historicalComplete,
    accounts: (bank?.accounts ?? []).map((a) => ({ name: a.name, mask: a.mask, type: a.type, subtype: a.subtype })),
    lastSyncedAt: c.lastSuccessAt,
    coveredFrom: c.coverage.from,
    coveredTo: c.coverage.to,
    needsReconnect: c.state === "expired" || bank?.problem === "needsReconnect",
  };
}

/**
 * Ruling 9, inside the reset's last transaction: every bank connection stays, with its cursor null, its coverage
 * unknown and any pull's lease dropped, so the next pull imports again and a pull that began before the reset can't
 * advance the cursor over rows the reset cleared. The token is kept. `skip` names paths this transaction deletes
 * (brief 054: a simulated connector left on a tenant that is no longer a demo visit), which may not also be written.
 */
export async function resetBankCursors(tx: Tx, uid: string, opsNow: number, skip: ReadonlySet<string> = new Set()): Promise<number> {
  const all = await listConnectors(tx, uid);
  let n = 0;
  for (const c of all) {
    if (c.data.provider !== "plaid" || c.data.bank === null || skip.has(c.path)) continue;
    const now = tsFromMs(opsNow);
    tx.update(c.path, {
      ...c.data,
      cursor: null,
      coverage: UNKNOWN_COVERAGE,
      lastSuccessAt: null,
      quota: { nextAllowedAt: now, leaseUntil: null, leaseToken: null },
      state: c.data.state === "connected" ? "syncing" : c.data.state,
      bank: { ...c.data.bank, historicalComplete: false },
      updatedAt: now,
    });
    n++;
  }
  return n;
}
