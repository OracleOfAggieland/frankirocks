/**
 * Brief 049 ruling 18: the two stored Google documents (`connectors/{gmailId}`, `connectors/{calendarId}`), what the
 * screen may see of them (`GoogleView`), and which may be read. One Google account per owner. The IDs are
 * deterministic from the owner and the provider, so a reconnect reuses them and a forgotten message's provider key
 * stays the same.
 */
import { type Connector, type GoogleConnection, type GoogleView, type Hasher, tsFromMs, withConnectorDefaults } from "@franki/core";
import { cFields } from "../records";
import { paths } from "../store/paths";
import type { Reader, StoredDoc } from "../store/port";

export const GOOGLE_PROVIDERS = ["gmail", "calendar"] as const;
export type GoogleProvider = (typeof GOOGLE_PROVIDERS)[number];

export const googleConnectorId = (hasher: Hasher, uid: string, provider: GoogleProvider) => hasher.id(["google-connector", uid, provider]);
/**
 * Review S3: the ID one account's rows on one document are keyed under. Generation 0 (the first account) keeps the
 * document's own ID, so its keys are what they always were; a later account's generation has keys of its own, so
 * its rows, provider keys and blocks never meet the first account's.
 */
export const googleKeyScope = (hasher: Hasher, connectorId: string, generation: number) => (generation === 0 ? connectorId : hasher.id(["google-account-scope", connectorId, String(generation)]));
/** H(Google's `sub`) for one owner: recognises a second account without storing the raw ID. */
export const googleAccountKey = (hasher: Hasher, uid: string, sub: string) => hasher.id(["google-account", uid, sub]);

export interface GoogleDocs {
  gmail: StoredDoc<Connector> | null;
  calendar: StoredDoc<Connector> | null;
}

/** One provider's document (review fix T12: readiness reads only its own, so a poll costs one read per agent). */
export async function readGoogleDoc(reader: Pick<Reader, "get">, uid: string, hasher: Hasher, provider: GoogleProvider): Promise<StoredDoc<Connector> | null> {
  return one(reader, uid, hasher, provider);
}

async function one(reader: Pick<Reader, "get">, uid: string, hasher: Hasher, provider: GoogleProvider): Promise<StoredDoc<Connector> | null> {
  const doc = await reader.get(paths.connector(uid, googleConnectorId(hasher, uid, provider)));
  if (doc === null) return null;
  const data = withConnectorDefaults(doc.data as Parameters<typeof withConnectorDefaults>[0]);
  // Only a document of this provider with a Google part is one of ours.
  return data.provider === provider && data.google !== null ? { ...doc, data } : null;
}

export async function readGoogleDocs(reader: Pick<Reader, "get">, uid: string, hasher: Hasher): Promise<GoogleDocs> {
  const [gmail, calendar] = await Promise.all([one(reader, uid, hasher, "gmail"), one(reader, uid, hasher, "calendar")]);
  return { gmail, calendar };
}

/** A document's rows may be read, and its token used: granted, connected, with a sealed token. */
export const isReadableGoogle = (c: Connector | null | undefined): boolean =>
  c !== null && c !== undefined && c.google !== null && c.google.granted && c.google.token !== null && c.state === "connected";

const partOf = (c: Connector | null): GoogleView["mail"] => {
  if (c === null || c.google === null || !c.google.granted) return "off";
  if (c.state === "expired") return "expired";
  return isReadableGoogle(c) ? "connected" : "off";
};

/** What the screen may show: the address, and mail and calendar each off, connected or expired. */
export function googleView(docs: GoogleDocs): GoogleView {
  const mail = partOf(docs.gmail?.data ?? null);
  const calendar = partOf(docs.calendar?.data ?? null);
  const live = [docs.gmail?.data, docs.calendar?.data].filter((c): c is Connector => c !== undefined && c !== null && c.google !== null && c.google.granted);
  const first = live[0]?.google ?? null;
  return {
    email: mail === "off" && calendar === "off" ? null : (first?.email ?? null),
    mail,
    calendar,
    needsReconnect: mail === "expired" || calendar === "expired",
    connectedAt: mail === "off" && calendar === "off" ? null : (first?.connectedAt ?? null),
  };
}

export const EMPTY_GOOGLE: GoogleConnection = { accountKey: null, email: null, granted: false, token: null, connectedAt: null, pending: null };

/** A new, disconnected Google document (the first start creates the `gmail` one to hold the pending state). */
export function newGoogleConnector(uid: string, provider: GoogleProvider, opsNow: number, core: { epoch: number; policyRev: number }): Connector {
  const at = tsFromMs(opsNow);
  return {
    ...cFields(uid, at, core.epoch, core.policyRev),
    provider,
    state: "disconnected",
    activeGeneration: 0,
    stagingGeneration: null,
    cursor: null,
    coverage: { state: "unknown", from: null, to: null, missingRanges: [], generation: 0 },
    nextPollAt: at,
    watchExpiresAt: null,
    quota: { nextAllowedAt: at, leaseUntil: null, leaseToken: null },
    lastSuccessAt: null,
    lastError: null,
    retainUntil: null,
    bank: null,
    google: EMPTY_GOOGLE,
  };
}
