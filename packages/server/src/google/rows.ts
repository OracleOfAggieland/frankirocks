/**
 * Brief 049 ruling 20: a message or an event, as read, becomes Evidence. There is no mailbox import: only what a
 * read returns is stored. The fields come from the seed's own builders (`mailRowFields`, `calendarRowFields` in
 * seed/build.ts) with `source: "gmail"` or `"calendar"`, the connector's ID, and a deterministic ID from the
 * provider's ID, so reading the same thing twice writes nothing new and a changed one is a new revision.
 */
import { type Evidence, type Hasher, canonicalJSON, tsFromMs } from "@franki/core";
import { cFields } from "../records";
import { calendarRowFields, mailRowFields } from "../seed/build";
import { appendEvidenceRevision, evidenceId } from "../store/evidence";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import { type EventContent, calendarKeyOf, calendarProviderKey } from "./calendar";
import { GMAIL_PARSER_VERSION, GMAIL_PARSER_VERSION_CUT, type MailContent, gmailProviderKey, gmailThreadKey, mailAddressKey } from "./mail";

export const CALENDAR_PARSER_VERSION = "gcal-read-v1";
/** A row past this many revisions keeps its latest one (fails closed: nothing is overwritten). */
export const GOOGLE_MAX_REVISIONS = 64;

export interface GoogleRowContext {
  uid: string;
  connectorId: string;
  epoch: number;
  policyRev: number;
  opsNow: number;
  hasher: Hasher;
}

function base(ctx: GoogleRowContext, logicalId: string, revisionOf: string | null, source: "gmail" | "calendar", parserVersion: string, zone: string | null): Evidence {
  const now = tsFromMs(ctx.opsNow);
  return {
    ...cFields(ctx.uid, now, ctx.epoch, ctx.policyRev),
    logicalId,
    revisionOf,
    sanitizedFrom: null,
    source,
    providerKey: null,
    providerRevision: null,
    connectorId: ctx.connectorId,
    generation: 0,
    threadKey: null,
    inReplyToProviderKey: null,
    closureProofs: [],
    kind: "note",
    status: "retained",
    isCurrentProvider: true,
    occurredAt: now,
    assertedAt: now,
    receivedAt: now,
    zone,
    fieldSlices: [],
    body: null,
    bodyOwn: null,
    bodyQuoted: null,
    subject: null,
    title: null,
    description: null,
    text: null,
    sender: null,
    recipient: [],
    observation: { kind: "none" },
    authorId: null,
    senderAddressKey: null,
    recipientAddressKeys: [],
    authorship: "unknown",
    delivery: "unknown",
    senderAuth: "unknown",
    identityBinding: "none",
    route: "unknown",
    sessionId: null,
    turnId: null,
    itemIds: [],
    transcriptState: "complete",
    transcriptDeadline: null,
    controlTurn: false,
    extractPacketMode: "source",
    parserVersion,
    copyRootKey: null,
    replacedProviderKey: null,
    sanitizeMap: [],
    purgedAt: null,
  };
}

/** One message's Evidence. Own sent mail is O; everything else T. The sender's authentication is not checked. */
export function mailEvidence(eid: string, logicalId: string, revisionOf: string | null, messageId: string, m: MailContent, ctx: GoogleRowContext): Evidence {
  const { hasher, uid, connectorId } = ctx;
  const fields = mailRowFields(
    {
      eid,
      at: tsFromMs(m.occurredAtMs),
      providerKey: gmailProviderKey(hasher, connectorId, messageId),
      threadKey: gmailThreadKey(hasher, connectorId, m.threadId),
      // In-Reply-To names a Message-ID header, not a Gmail ID; it is not mapped (no second read to find it).
      inReplyToProviderKey: null,
      subject: m.subject,
      body: m.body,
      sender: m.sender,
      recipient: m.recipient,
      fromSelf: m.fromSelf,
      senderAddressKey: m.senderAddress === null ? null : mailAddressKey(hasher, uid, m.senderAddress),
      recipientAddressKeys: m.recipient.map((a) => mailAddressKey(hasher, uid, a)),
      bulk: m.bulk,
      senderAuth: "unknown",
    },
    hasher,
  );
  return { ...base(ctx, logicalId, revisionOf, "gmail", m.bodyCut ? GMAIL_PARSER_VERSION_CUT : GMAIL_PARSER_VERSION, null), ...fields };
}

/** One event's Evidence at revision `version`. */
export function eventEvidence(eid: string, logicalId: string, revisionOf: string | null, version: number, e: EventContent, ctx: GoogleRowContext): Evidence {
  const { hasher, connectorId } = ctx;
  const fields = calendarRowFields(
    {
      eid,
      providerKey: calendarProviderKey(hasher, connectorId, e.eventId),
      calendarKey: calendarKeyOf(hasher, connectorId),
      start: tsFromMs(e.startMs),
      end: tsFromMs(e.endMs),
      zone: e.zone,
      allDay: e.allDay,
      status: e.status,
      selfResponse: e.selfResponse,
      transparency: e.transparency,
      organizerSelf: e.organizerSelf,
      scheduleRev: version,
      assertedAt: tsFromMs(ctx.opsNow),
      providerRevision: e.etag ?? String(version),
      isCurrentProvider: true,
      title: e.title,
    },
    hasher,
  );
  return { ...base(ctx, logicalId, revisionOf, "calendar", CALENDAR_PARSER_VERSION, e.zone), ...fields };
}

/** What makes two revisions the same: their content, never their IDs, revision counters or read times. */
export function rowContentKey(e: Evidence): string {
  const o = e.observation.kind === "calendar" ? { ...e.observation, scheduleRev: 0 } : e.observation;
  return canonicalJSON({ subject: e.subject, body: e.body, sender: e.sender, recipient: e.recipient, title: e.title, occurredAt: e.occurredAt, threadKey: e.threadKey, authorship: e.authorship, route: e.route, parserVersion: e.parserVersion, observation: o });
}

async function latestRevision(tx: Pick<Tx, "get">, uid: string, logicalId: string, hasher: Hasher): Promise<{ eid: string; version: number; data: Evidence } | null> {
  let found: { eid: string; version: number; data: Evidence } | null = null;
  for (let v = 1; v <= GOOGLE_MAX_REVISIONS; v++) {
    const eid = evidenceId(logicalId, v, hasher);
    const doc = await tx.get<Evidence>(paths.evidence(uid, eid));
    if (doc === null) return found;
    found = { eid, version: v, data: doc.data };
  }
  return found;
}

/** Builds one revision: `eid`, the prior eid (or null) and the version number. */
export type BuildRow = (eid: string, revisionOf: string | null, version: number) => Evidence;

/**
 * Stores one row inside a transaction and answers its current eid: the stored latest revision when its content is the
 * same, else a new revision (or the first). Never edits a stored row.
 */
export async function storeRow(tx: Tx, uid: string, logicalId: string, build: BuildRow, hasher: Hasher): Promise<string> {
  const latest = await latestRevision(tx, uid, logicalId, hasher);
  if (latest === null) {
    const eid = evidenceId(logicalId, 1, hasher);
    tx.create(paths.evidence(uid, eid), build(eid, null, 1));
    return eid;
  }
  if (rowContentKey(build(latest.eid, latest.data.revisionOf, latest.version)) === rowContentKey(latest.data) || latest.version >= GOOGLE_MAX_REVISIONS) return latest.eid;
  const eid = evidenceId(logicalId, latest.version + 1, hasher);
  await appendEvidenceRevision(tx, uid, latest.eid, build(eid, latest.eid, latest.version + 1), hasher);
  return eid;
}
