/**
 * Debug_Panel data (R29.3–R29.8, R21.9). Loads every section of `GET /api/debug/memory`, following `nextCursor`
 * up to MAX_PAGES pages per section, and keeps the last good load when a fetch fails or takes over 3 s, with the
 * time of that load for the stale indicator. Pure helpers for ordering and highlighting are exported for tests.
 */
import {
  type CoreBundle,
  type DebugItem,
  DebugPage,
  type DebugSection,
  type DebugSessionView,
  type Evidence,
  type Infer,
  type Job,
  type Ledger,
  type Slice,
  type Turn,
  evidenceFieldText,
  tsFromMs,
  validate,
} from "@franki/core";
import type { ApiClient } from "./api";
import type { BrowserClock } from "./clock";

export const DEBUG_TIMEOUT_MS = 3_000;
export const DEBUG_POLL_MS = 5_000;
/** Pages followed per section on one load (50 items each). */
export const MAX_PAGES = 10;

type Item<K extends DebugItem["kind"]> = Extract<DebugItem, { kind: K }>;

export interface DebugData {
  turns: Item<"turn">[];
  evidence: Item<"evidence">[];
  memories: Item<"memory">[];
  jobs: Item<"job">[];
  ledger: Item<"ledger">[];
  head: CoreBundle | null;
  /** `core/rules` and its proof checks (brief 018 task B11); null before the first open. */
  rules: Item<"rules"> | null;
  /** The current Session's audience and parses, from the turns section (voice-control R13.5). */
  session: DebugSessionView | null;
  /** Sections with more pages than were loaded. */
  truncated: DebugSection[];
}

export interface DebugState {
  data: DebugData | null;
  /** opsClock TS of the last successful load. */
  lastLoadedAt: string | null;
  /** True when the latest fetch failed; `data` is then the last good load. */
  stale: boolean;
  error: string | null;
  loading: boolean;
}

const SECTIONS: DebugSection[] = ["turns", "evidence", "memories", "jobs", "ledger", "head", "rules"];

// ---------------------------------------------------------------------------------------------
// Pure helpers

/** R19.6 order: seq ascending; user before assistant at equal seq; then committedAt ascending. */
export function sortTurns<T extends { record: Turn }>(turns: readonly T[]): T[] {
  const rank = (t: Turn) => (t.role === "user" ? 0 : 1);
  return [...turns].sort(
    (a, b) => a.record.seq - b.record.seq || rank(a.record) - rank(b.record) || (a.record.committedAt < b.record.committedAt ? -1 : a.record.committedAt > b.record.committedAt ? 1 : 0),
  );
}

export interface Segments {
  before: string;
  marked: string;
  after: string;
}

/** Splits the Evidence field text around a root Slice's `[start, end)`, or null when the range does not fit. */
export function highlight(evidence: Evidence | undefined, slice: Slice): Segments | null {
  if (evidence === undefined || slice.start === null || slice.end === null) return null;
  const text = evidenceFieldText(evidence, slice.fieldPath);
  if (text === null || slice.end > text.length || slice.start > slice.end) return null;
  return { before: text.slice(0, slice.start), marked: text.slice(slice.start, slice.end), after: text.slice(slice.end) };
}

/** The turn ID an admission or extraction ledger entry refers to, from its turn Ref. */
export function ledgerTurnId(entry: Ledger): string | null {
  if (entry.kind !== "decision") return null;
  const ref = [...entry.payload.acceptedRefs, ...entry.payload.heldRefs].find((r) => r.type === "turn");
  return ref === undefined ? null : ref.id;
}

/** The Evidence ID an Extract_Job reads (its first source), and that Evidence's Turn when loaded. */
export function jobSource(job: Job, evidenceById: ReadonlyMap<string, Evidence>): { eid: string | null; turnId: string | null } {
  const eid = job.sourceIds[0] ?? null;
  return { eid, turnId: eid === null ? null : (evidenceById.get(eid)?.turnId ?? null) };
}

/**
 * Decisions grouped by their Turn, in the order each Turn first appears (voice-control R13.4). The route already
 * groups each page; this keeps the groups whole across pages. Entries with no turn Ref stay on their own.
 */
export function decisionsByTurn(items: readonly Item<"ledger">[]): { turnId: string | null; items: Item<"ledger">[] }[] {
  const groups: { turnId: string | null; items: Item<"ledger">[] }[] = [];
  const byTurn = new Map<string, { turnId: string | null; items: Item<"ledger">[] }>();
  for (const item of items) {
    const turnId = item.turnId ?? ledgerTurnId(item.record as unknown as Ledger);
    const existing = turnId === null ? undefined : byTurn.get(turnId);
    if (existing !== undefined) existing.items.push(item);
    else {
      const g = { turnId, items: [item] };
      groups.push(g);
      if (turnId !== null) byTurn.set(turnId, g);
    }
  }
  return groups;
}

/** One row of the rules section (brief 018 task B11): a rule, or one an open proposal would install. */
export interface RuleRow {
  id: string;
  from: "rule" | "proposal";
  /** "You", the owner's word for the subject, the subject's ID, or "anyone" for an anonymous rule. */
  subject: string;
  code: string;
  state: "active" | "pending";
  quote: string | null;
  span: string | null;
  proof: Item<"rules">["proofs"][number]["state"];
  /** The proposal's origin, for a proposed rule. */
  origin: "repair" | "backstop" | null;
}

/** The rules section's rows, rules first, then each open proposal's, with the proof check the route made. */
export function ruleRows(item: Item<"rules">): RuleRow[] {
  const r = item.record;
  const label = (rule: (typeof r.allergies)[number]) =>
    rule.anonymous || rule.subjectId === null ? "anyone" : rule.subjectId === "self" ? "You" : (r.subjectLabels.find((l) => l.subjectId === rule.subjectId)?.label ?? rule.subjectId);
  const listed = [
    ...r.allergies.map((rule) => ({ rule, from: "rule" as const, origin: null })),
    ...r.proposals.flatMap((p) => p.install.map((rule) => ({ rule, from: "proposal" as const, origin: p.origin }))),
  ];
  return listed.map(({ rule, from, origin }, i) => ({
    id: rule.id,
    from,
    subject: label(rule),
    code: rule.code,
    state: rule.state,
    quote: rule.proof?.quote ?? null,
    span: rule.proof === null ? null : `${rule.proof.eid} [${rule.proof.start}, ${rule.proof.end})`,
    proof: item.proofs[i]?.ruleId === rule.id ? item.proofs[i]!.state : "none",
    origin,
  }));
}

/** The issuer as the panel names it (R13.4). */
export const issuerLabel = (issuer: Item<"ledger">["issuer"]): string => (issuer === "browser" ? "browser (fastO)" : issuer === "seam" ? "seam" : "—");

// ---------------------------------------------------------------------------------------------
// Loader

export interface DebugDeps {
  api: ApiClient;
  clock: BrowserClock;
}

export class DebugPanelModel {
  private state: DebugState = { data: null, lastLoadedAt: null, stale: false, error: null, loading: false };
  private listeners = new Set<() => void>();
  private inFlight: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor(private readonly deps: DebugDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DebugState => this.state;

  /**
   * Loads every section. A call while a load runs queues exactly one more load after it, so a Turn acknowledged
   * mid-load is still picked up (R29.7); further calls join that queued load.
   */
  refresh(): Promise<void> {
    if (this.inFlight !== null) {
      this.queued ??= this.inFlight.then(() => {
        this.queued = null;
        return this.refresh();
      });
      return this.queued;
    }
    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    this.set({ loading: true });
    const out: Partial<Record<DebugSection, DebugItem[]>> = {};
    const truncated: DebugSection[] = [];
    let session: DebugSessionView | null = null;
    for (const section of SECTIONS) {
      const r = await this.section(section);
      if (typeof r === "string") {
        // Keep the last good data and mark it stale (R29.8).
        this.set({ loading: false, stale: true, error: r });
        return;
      }
      out[section] = r.items;
      if (section === "turns") session = r.session;
      if (r.truncated) truncated.push(section);
    }
    const headItem = (out.head ?? []).find((i): i is Item<"head"> => i.kind === "head");
    const data: DebugData = {
      turns: sortTurns((out.turns ?? []).filter((i): i is Item<"turn"> => i.kind === "turn")),
      evidence: (out.evidence ?? []).filter((i): i is Item<"evidence"> => i.kind === "evidence"),
      memories: (out.memories ?? []).filter((i): i is Item<"memory"> => i.kind === "memory"),
      jobs: (out.jobs ?? []).filter((i): i is Item<"job"> => i.kind === "job"),
      ledger: (out.ledger ?? []).filter((i): i is Item<"ledger"> => i.kind === "ledger"),
      head: headItem?.record ?? null,
      rules: (out.rules ?? []).find((i): i is Item<"rules"> => i.kind === "rules") ?? null,
      session,
      truncated,
    };
    this.set({ data, loading: false, stale: false, error: null, lastLoadedAt: tsFromMs(this.deps.clock.read().opsClock.now) });
  }

  private async section(section: DebugSection): Promise<{ items: DebugItem[]; truncated: boolean; session: DebugSessionView | null } | string> {
    const items: DebugItem[] = [];
    let session: DebugSessionView | null = null;
    let cursor: string | null = null;
    for (let n = 0; n < MAX_PAGES; n++) {
      const r = await this.deps.api.call<unknown>("/api/debug/memory", { query: { section, cursor }, timeoutMs: DEBUG_TIMEOUT_MS });
      if (!r.ok) {
        if (r.kind === "timeout") return `The ${section} fetch took over 3 seconds.`;
        if (r.kind === "http") return `The ${section} fetch failed: ${r.error ?? `HTTP ${r.status}`}.`;
        return r.kind === "signedOut" ? "Signed out." : `The ${section} fetch failed: network error.`;
      }
      const parsed = validate(DebugPage, r.body);
      if (!parsed.ok) return `The ${section} fetch returned an unexpected page (${parsed.path}).`;
      const page = parsed.value as Infer<typeof DebugPage>;
      items.push(...page.items);
      session ??= page.session;
      cursor = page.nextCursor;
      if (cursor === null) return { items, truncated: false, session };
    }
    return { items, truncated: true, session };
  }

  private set(patch: Partial<DebugState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
