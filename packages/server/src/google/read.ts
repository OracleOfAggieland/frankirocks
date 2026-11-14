/**
 * Brief 049 rulings 17, 20, 21, 23 and 25: the reads Part C's errand tools call. Plain functions over a route
 * context, with no model, no tool and no route of their own. Each one:
 *
 * - refreshes the access token in memory only (never stored, logged or answered), once per run per provider;
 * - answers `unavailable` when Google is not configured, `notConnected` when the provider isn't granted or was
 *   disconnected, `expired` when Google answered `invalid_grant` (the connector is then marked `expired`), `failed`
 *   for anything else, and `forgotten` when the forget epoch moved since the caller began or a forget holds the
 *   barrier (nothing is written then);
 * - drops a message or event whose provider ID a forget blocked before fetching or storing it (spec §8 "What stays
 *   gone");
 * - stores what it read as Evidence (rows.ts) and answers bounded data plus the Evidence IDs it read, after running
 *   each through `eligible()` at stage `toolReturn`;
 * - never reads a fixture row: only rows of the owner's own Google connectors.
 *
 * Bodies never leave `readableMessage`, which is for the tool-less reader only.
 */
import {
  type BusyEvent,
  type CoreEpoch,
  DEFAULT_DAY_BOUNDS,
  type DayBounds,
  type Evidence,
  FREE_TIME_DAYS_MAX,
  type MailQuery,
  type Snapshot,
  docRef,
  eligible,
  freeGaps,
  gmailQuery,
  msFromTs,
  safeName,
  tsFromMs,
} from "@franki/core";
import { ConfigError } from "../config/env";
import { ownerClock, readCoreDocs } from "../core-docs";
import { forgetRowsFor } from "../forget/snapshot-rows";
import { foregroundEC, storeReader } from "../head-build";
import type { RouteContext } from "../routes/runtime";
import { SealError, unseal } from "../sealed";
import { paths } from "../store/paths";
import { StoreError } from "../store/errors";
import type { Reader, StoredDoc, Tx } from "../store/port";
import { calendarLogicalId, calendarProviderKey, calendarZone, eventContent } from "./calendar";
import { type GoogleProvider, googleConnectorId, googleKeyScope, isReadableGoogle, readGoogleDocs } from "./connector";
import { CALENDAR_SCOPE, GMAIL_SCOPE } from "./oauth";
import { gmailLogicalId, gmailProviderKey, mailContent, GMAIL_PARSER_VERSION_CUT } from "./mail";
import { GoogleCallError } from "./port";
import { type GoogleRowContext, eventEvidence, mailEvidence, storeRow } from "./rows";
import { type GoogleRuntime, googleRuntime } from "./routes";

/** Ruling 23: a search answers at most this many messages. */
export const MAIL_SEARCH_MAX = 8;
/** Ruling 23: a subject is answered cut to this many characters. */
export const MAIL_SUBJECT_ANSWER_CHARS = 120;
/** Ruling 25: a title is answered cut to this many characters; at most 50 events. */
export const EVENT_TITLE_ANSWER_CHARS = 120;
export const EVENTS_MAX = 50;
/** The most body text the reader is given. */
export const READER_BODY_CHARS = 12_000;

export type GoogleReadFailure = "unavailable" | "notConnected" | "expired" | "failed" | "forgotten";
export type GoogleRead<T> = { ok: true; value: T } | { ok: false; why: GoogleReadFailure };

export interface GoogleReadContext {
  route: RouteContext;
  /** The forget epoch the caller began under (the Errand's, when it was claimed). */
  epoch: number;
  /** Access tokens this run fetched, in memory only. */
  tokens: Map<GoogleProvider, string>;
}

export const googleReadContext = (route: RouteContext, epoch: number): GoogleReadContext => ({ route, epoch, tokens: new Map() });

/** One message a search found. Never the body. */
export interface MailHit {
  eid: string;
  /** The sender's name (or address) through `safeName`. */
  sender: string;
  at: string;
  /** Cut to 120 characters; null when the message has none. */
  subject: string | null;
  fromSelf: boolean;
  unread: boolean;
}

/** One message's text for the tool-less reader. */
export interface ReaderText {
  eid: string;
  sender: string;
  at: string;
  subject: string | null;
  body: string;
  /** The stored body was cut at its bound, or the reader's cut shortened it. */
  cut: boolean;
}

export interface EventRow {
  eid: string;
  title: string | null;
  start: string;
  end: string;
  allDay: boolean;
  organizerSelf: boolean;
}

export interface EventWindow {
  fromMs: number;
  toMs: number;
}

const fail = <T>(why: GoogleReadFailure): GoogleRead<T> => ({ ok: false, why });
const nowOf = (g: GoogleReadContext) => g.route.deps.clock.read().opsClock.now;

class ReadStop extends Error {
  constructor(readonly why: GoogleReadFailure) {
    super(`google read stopped: ${why}`);
  }
}

/** The current epoch, or a stop when it moved or a forget holds the barrier. */
async function fence(reader: Pick<Reader, "get">, g: GoogleReadContext): Promise<CoreEpoch> {
  const epoch = (await reader.get<CoreEpoch>(paths.core(g.route.uid, "epoch")))?.data ?? null;
  if (epoch === null || epoch.barrier || epoch.epoch !== g.epoch) throw new ReadStop("forgotten");
  return epoch;
}

function runtime(g: GoogleReadContext): GoogleRuntime {
  try {
    return googleRuntime(g.route);
  } catch (error) {
    if (error instanceof ConfigError) throw new ReadStop("unavailable");
    throw error;
  }
}

/** Marks both documents `expired` and erases their tokens (Google answered `invalid_grant`). */
async function markExpired(g: GoogleReadContext): Promise<void> {
  const { uid, deps } = g.route;
  try {
    await deps.store.transaction(uid, async (tx) => {
      const docs = await readGoogleDocs(tx, uid, deps.hasher);
      for (const d of [docs.gmail, docs.calendar]) {
        if (d === null || d.data.google === null || !d.data.google.granted || d.data.state === "disconnected") continue;
        tx.update(d.path, { ...d.data, state: "expired", lastError: "AUTH", updatedAt: tsFromMs(nowOf(g)), google: { ...d.data.google, token: null } });
      }
    });
  } catch {
    deps.log("google.expireUnwritten", {});
  }
}

/** What one read is bound to: the document, the account generation it began under, and that generation's key scope. */
interface Access {
  token: string;
  connectorId: string;
  generation: number;
  scope: string;
}

/**
 * Review S3 and S4: inside the storing transaction, the document must still be readable and still on the account
 * generation the read began under. A disconnect or a different account that committed mid-read wins: nothing is
 * stored, and the read answers as disconnected.
 */
async function stillReadable(tx: Pick<Tx, "get">, g: GoogleReadContext, provider: GoogleProvider, generation: number): Promise<void> {
  const doc = (await readGoogleDocs(tx, g.route.uid, g.route.deps.hasher))[provider];
  if (doc === null || !isReadableGoogle(doc.data) || doc.data.activeGeneration !== generation) throw new ReadStop("notConnected");
}

/** Review D7: one transaction, tried again once when a concurrent read stored the same row first. */
async function storeOnce<T>(g: GoogleReadContext, work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await g.route.deps.store.transaction(g.route.uid, work);
    } catch (error) {
      if (!(error instanceof StoreError && error.code === "staleRevision")) throw error;
      if (attempt >= 1) {
        g.route.deps.log("google.storeContended", {});
        throw new ReadStop("failed");
      }
    }
  }
}

/** An access token for one provider, refreshed once per run and kept in memory only. */
async function accessFor(g: GoogleReadContext, rt: GoogleRuntime, provider: GoogleProvider): Promise<Access> {
  const { uid, deps } = g.route;
  const connectorId = googleConnectorId(deps.hasher, uid, provider);
  const reader = storeReader(deps.store, uid);
  await fence(reader, g);
  const docs = await readGoogleDocs(reader, uid, deps.hasher);
  const doc = docs[provider];
  if (doc === null || doc.data.google === null || !doc.data.google.granted) throw new ReadStop("notConnected");
  if (doc.data.state === "expired") throw new ReadStop("expired");
  if (!isReadableGoogle(doc.data)) throw new ReadStop("notConnected");
  const generation = doc.data.activeGeneration;
  const bound = { connectorId, generation, scope: googleKeyScope(deps.hasher, connectorId, generation) };
  const cached = g.tokens.get(provider);
  if (cached !== undefined) return { token: cached, ...bound };
  let refreshToken: string;
  try {
    refreshToken = unseal("franki-google-token", rt.config.tokenKeys, uid, connectorId, doc.data.google.token!);
  } catch (error) {
    if (error instanceof SealError) {
      deps.log("google.tokenDidNotOpen", {});
      throw new ReadStop("failed");
    }
    throw error;
  }
  try {
    const r = await rt.port.refresh(rt.config, refreshToken);
    if (r.scope !== null && !r.scope.includes(provider === "gmail" ? GMAIL_SCOPE : CALENDAR_SCOPE)) throw new ReadStop("notConnected");
    g.tokens.set(provider, r.accessToken);
    return { token: r.accessToken, ...bound };
  } catch (error) {
    if (error instanceof GoogleCallError && error.problem === "invalidGrant") {
      await markExpired(g);
      throw new ReadStop("expired");
    }
    if (error instanceof ReadStop) throw error;
    deps.log("google.refreshFailed", {});
    throw new ReadStop("failed");
  }
}

/**
 * The provider keys a forget has blocked, active or in review. Review D6: past the snapshot's 128 blocks the list is
 * incomplete, so a blocked message could be fetched and stored again; the read fails closed instead.
 */
async function blockedKeys(reader: Reader, uid: string): Promise<{ keys: Set<string>; forget: Awaited<ReturnType<typeof forgetRowsFor>> }> {
  const forget = await forgetRowsFor(reader, uid);
  if (!forget.complete) throw new ReadStop("failed");
  return { keys: new Set(forget.blocks.filter((b) => b.kind === "provider" && b.providerKey !== null).map((b) => b.providerKey!)), forget };
}

/** Keeps the stored rows `eligible()` allows at stage `toolReturn`, with the forget snapshot. */
async function eligibleRows(g: GoogleReadContext, reader: Reader, docs: StoredDoc<Evidence>[], forget: Awaited<ReturnType<typeof forgetRowsFor>>): Promise<StoredDoc<Evidence>[]> {
  const { uid, deps } = g.route;
  const core = await readCoreDocs(reader, uid);
  const clock = ownerClock(core.state.data, deps.clock);
  const refs = [...docs.map((d) => docRef("evidence", d.id, d.data.rev)), ...forget.refs];
  const snapshot: Snapshot = {
    uid,
    epoch: core.epoch.data,
    session: null,
    job: null,
    localGeneration: 0,
    refs,
    rows: [...docs.map((d) => d.data), ...forget.rows],
    blocks: forget.blocks,
    coverage: core.state.data.coverage,
    complete: forget.complete,
  };
  const ec = { ...foregroundEC(uid, core.epoch.data, clock, 0), stage: "toolReturn" as const };
  return docs.filter((d) => eligible({ ref: docRef("evidence", d.id, d.data.rev), row: d.data }, ec, snapshot).allow);
}

async function guarded<T>(work: () => Promise<GoogleRead<T>>): Promise<GoogleRead<T>> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ReadStop) return fail(error.why);
    throw error;
  }
}

/** The display name of a stored sender: the name before the address, else the address, through `safeName`. */
function senderOf(e: Evidence): string {
  const s = e.sender ?? "";
  const m = /^(.*?)<[^<>]*>\s*$/.exec(s.slice(0, 400));
  const name = m === null ? s : m[1]!.replace(/^[\s"']+|[\s"']+$/g, "");
  return safeName(name === "" ? s : name);
}

const cutTo = (s: string | null, n: number) => (s === null ? null : s.length > n ? s.slice(0, n) : s);

async function readStored(reader: Reader, uid: string, eids: string[]): Promise<StoredDoc<Evidence>[]> {
  const out: StoredDoc<Evidence>[] = [];
  for (const eid of eids) {
    const d = await reader.get<Evidence>(paths.evidence(uid, eid));
    if (d !== null) out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mail

/**
 * Ruling 23 `search_mail`: Gmail's query is built by code (`gmailQuery`), at most 8 messages. Each message found is
 * fetched once and stored as Evidence; a blocked one is neither fetched nor stored. Answers sender, date and subject,
 * never the body.
 */
export function searchMail(g: GoogleReadContext, q: MailQuery): Promise<GoogleRead<{ hits: MailHit[]; read: string[] }>> {
  return guarded(async () => {
    const { uid, deps } = g.route;
    const rt = runtime(g);
    const access = await accessFor(g, rt, "gmail");
    const { token, connectorId, scope } = access;
    let refs: Awaited<ReturnType<typeof rt.port.listMessages>>;
    try {
      refs = await rt.port.listMessages(token, gmailQuery(q), MAIL_SEARCH_MAX);
    } catch {
      deps.log("google.searchFailed", {});
      return fail("failed");
    }
    const reader = storeReader(deps.store, uid);
    const { keys, forget } = await blockedKeys(reader, uid);
    const wanted = refs.slice(0, MAIL_SEARCH_MAX).filter((r) => !keys.has(gmailProviderKey(deps.hasher, scope, r.id)));
    const fetched = await Promise.allSettled(wanted.map((r) => rt.port.getMessage(token, r.id)));
    const messages = fetched.flatMap((f) => (f.status === "fulfilled" ? [f.value] : []));
    if (wanted.length > 0 && messages.length === 0) {
      deps.log("google.messagesFailed", {});
      return fail("failed");
    }
    const eids = await storeOnce(g, async (tx) => {
      const epoch = await fence(tx, g);
      await stillReadable(tx, g, "gmail", access.generation);
      const ctx: GoogleRowContext = { uid, connectorId, generation: access.generation, keyScope: scope, epoch: epoch.epoch, policyRev: epoch.policyRev, opsNow: nowOf(g), hasher: deps.hasher };
      const out: string[] = [];
      for (const m of messages) {
        const content = mailContent(m);
        if (content === null) continue;
        const logicalId = gmailLogicalId(deps.hasher, uid, scope, m.id);
        out.push(await storeRow(tx, uid, logicalId, (eid, revisionOf) => mailEvidence(eid, logicalId, revisionOf, m.id, content, ctx), deps.hasher));
      }
      return out;
    });
    const unread = new Map(messages.map((m) => [gmailProviderKey(deps.hasher, scope, m.id), m.labelIds.includes("UNREAD")]));
    const rows = await eligibleRows(g, reader, await readStored(reader, uid, eids), forget);
    const hits = rows.map((d) => ({
      eid: d.id,
      sender: senderOf(d.data),
      at: d.data.occurredAt,
      subject: cutTo(d.data.subject, MAIL_SUBJECT_ANSWER_CHARS),
      fromSelf: d.data.authorship === "self",
      unread: unread.get(d.data.providerKey ?? "") ?? false,
    }));
    return { ok: true, value: { hits, read: hits.map((h) => h.eid) } };
  });
}

/**
 * The text of one message for the tool-less reader (ruling 23 `read_mail`). Reads the stored row only; Google is not
 * called. The row must be a current gmail row of this owner's readable connector, not blocked, and eligible.
 */
export function readableMessage(g: GoogleReadContext, eid: string): Promise<GoogleRead<ReaderText>> {
  return guarded(async () => {
    const { uid, deps } = g.route;
    runtime(g);
    const reader = storeReader(deps.store, uid);
    await fence(reader, g);
    const connectorId = googleConnectorId(deps.hasher, uid, "gmail");
    const docs = await readGoogleDocs(reader, uid, deps.hasher);
    if (docs.gmail?.data.state === "expired") return fail("expired");
    if (!isReadableGoogle(docs.gmail?.data)) return fail("notConnected");
    const doc = /^[A-Za-z0-9_-]{1,128}$/.test(eid) ? await reader.get<Evidence>(paths.evidence(uid, eid)) : null;
    // Review S3: a row another account stored (an older generation) is not this account's to read.
    if (doc === null || doc.data.source !== "gmail" || doc.data.kind !== "message" || doc.data.connectorId !== connectorId || doc.data.generation !== docs.gmail!.data.activeGeneration) return fail("notConnected");
    const { keys, forget } = await blockedKeys(reader, uid);
    if (doc.data.providerKey !== null && keys.has(doc.data.providerKey)) return fail("forgotten");
    const [ok] = await eligibleRows(g, reader, [doc], forget);
    if (ok === undefined) return fail("forgotten");
    const e = ok.data;
    const stored = e.body !== null && e.body.kind === "inline" ? e.body.text : "";
    return {
      ok: true,
      value: {
        eid: ok.id,
        sender: senderOf(e),
        at: e.occurredAt,
        subject: cutTo(e.subject, MAIL_SUBJECT_ANSWER_CHARS),
        body: stored.slice(0, READER_BODY_CHARS),
        cut: e.parserVersion === GMAIL_PARSER_VERSION_CUT || stored.length > READER_BODY_CHARS,
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Calendar

function validWindow(w: EventWindow): boolean {
  return Number.isSafeInteger(w.fromMs) && Number.isSafeInteger(w.toMs) && w.toMs > w.fromMs && w.toMs - w.fromMs <= FREE_TIME_DAYS_MAX * 86_400_000;
}

/** Busy-or-free of one stored event row. */
function busyOf(e: Evidence): BusyEvent | null {
  if (e.observation.kind !== "calendar") return null;
  const o = e.observation;
  return { startMs: msFromTs(o.start), endMs: msFromTs(o.end), allDay: o.allDay, free: o.status === "cancelled" || o.selfResponse === "declined" || o.transparency === "transparent" };
}

async function readEvents(g: GoogleReadContext, window: EventWindow): Promise<GoogleRead<{ zone: string; docs: StoredDoc<Evidence>[] }>> {
  const { uid, deps } = g.route;
  if (!validWindow(window)) return fail("failed");
  const rt = runtime(g);
  const access = await accessFor(g, rt, "calendar");
  const { token, connectorId, scope } = access;
  let list: Awaited<ReturnType<typeof rt.port.listEvents>>;
  try {
    list = await rt.port.listEvents(token, { timeMin: tsFromMs(window.fromMs), timeMax: tsFromMs(window.toMs), max: EVENTS_MAX });
  } catch {
    deps.log("google.eventsFailed", {});
    return fail("failed");
  }
  const zone = calendarZone(list.timeZone);
  const reader = storeReader(deps.store, uid);
  const { keys, forget } = await blockedKeys(reader, uid);
  const events = list.items
    .slice(0, EVENTS_MAX)
    .map((item) => eventContent(item, zone))
    .filter((e): e is NonNullable<typeof e> => e !== null && !keys.has(calendarProviderKey(deps.hasher, scope, e.eventId)));
  const eids = await storeOnce(g, async (tx) => {
    const epoch = await fence(tx, g);
    await stillReadable(tx, g, "calendar", access.generation);
    const ctx: GoogleRowContext = { uid, connectorId, generation: access.generation, keyScope: scope, epoch: epoch.epoch, policyRev: epoch.policyRev, opsNow: nowOf(g), hasher: deps.hasher };
    const out: string[] = [];
    for (const e of events) {
      const logicalId = calendarLogicalId(deps.hasher, uid, scope, e.eventId);
      out.push(await storeRow(tx, uid, logicalId, (eid, revisionOf, version) => eventEvidence(eid, logicalId, revisionOf, version, e, ctx), deps.hasher));
    }
    return out;
  });
  return { ok: true, value: { zone, docs: await eligibleRows(g, reader, await readStored(reader, uid, eids), forget) } };
}

/**
 * Ruling 25 `list_events`: the primary calendar over a window of at most 14 days (resolved by the caller through the
 * pure resolver), single instances in start order, at most 50. Each event is stored as Evidence as it is read.
 */
export function listEvents(g: GoogleReadContext, window: EventWindow): Promise<GoogleRead<{ zone: string; events: EventRow[]; read: string[] }>> {
  return guarded(async () => {
    const r = await readEvents(g, window);
    if (!r.ok) return r;
    const events = r.value.docs.flatMap((d) => {
      const o = d.data.observation;
      if (o.kind !== "calendar") return [];
      return [{ eid: d.id, title: cutTo(d.data.title, EVENT_TITLE_ANSWER_CHARS), start: o.start, end: o.end, allDay: o.allDay, organizerSelf: o.organizerSelf }];
    });
    return { ok: true, value: { zone: r.value.zone, events, read: events.map((e) => e.eid) } };
  });
}

/**
 * Ruling 25 `find_free_time`: the gaps of at least `minutes` between the owner's busy events inside the day bounds,
 * computed by code (`freeGaps`). All-day, cancelled, declined and transparent events don't block.
 */
export function freeTime(g: GoogleReadContext, window: EventWindow, minutes: number, bounds: DayBounds = DEFAULT_DAY_BOUNDS): Promise<GoogleRead<{ zone: string; gaps: { start: string; end: string }[]; read: string[] }>> {
  return guarded(async () => {
    const r = await readEvents(g, window);
    if (!r.ok) return r;
    const busy = r.value.docs.map((d) => busyOf(d.data)).filter((b): b is BusyEvent => b !== null);
    const gaps = freeGaps(busy, window, r.value.zone, bounds, minutes).map((x) => ({ start: tsFromMs(x.startMs), end: tsFromMs(x.endMs) }));
    return { ok: true, value: { zone: r.value.zone, gaps, read: r.value.docs.map((d) => d.id) } };
  });
}
