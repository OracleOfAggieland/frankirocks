import { HEAD_SECTIONS, type CoreBundle, type DebugSessionView, type Evidence, type LatencyRow, type Ledger, summarize } from "@franki/core";
import { type DebugData, type DebugState, decisionsByTurn, highlight, issuerLabel, jobSource, ledgerTurnId } from "../client/debug-panel";

/**
 * The Debug_Panel (R21.9, R29.3–R29.8, R29.10). Presentational: data comes from `DebugPanelModel`. Every stored
 * string is rendered as a React text child, so stored HTML shows as literal text and never runs (R29.10).
 */
export interface DebugPanelProps {
  state: DebugState;
  selectedMemoryId: string | null;
  onSelectMemory: (id: string | null) => void;
  onRefresh: () => void;
  /** The Voice_Client's LatencyRows for the current call, oldest first (voice-control R18.2). */
  latency?: readonly LatencyRow[];
}

const HEAD_CAP = 3500;
const box = "rounded border border-stitch p-3 text-left";
const mono = "font-mono text-xs break-all";

export function DebugPanel({ state, selectedMemoryId, onSelectMemory, onRefresh, latency = [] }: DebugPanelProps) {
  const { data } = state;
  return (
    <section aria-label="Debug panel" className="flex w-full max-w-5xl flex-col gap-4 text-left text-sm text-ink">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Debug panel</h2>
        <button type="button" onClick={onRefresh} disabled={state.loading} className="rounded border border-ink-dim px-2 py-0.5 text-xs disabled:opacity-50">
          {state.loading ? "Loading…" : "Refresh"}
        </button>
        {state.lastLoadedAt !== null ? <span className="text-xs text-ink-dim">Loaded at {state.lastLoadedAt}</span> : null}
        {state.stale ? (
          <span role="status" data-testid="stale" className="rounded bg-night-2 px-2 py-0.5 text-xs text-brass-hi">
            Stale: showing data from {state.lastLoadedAt ?? "no successful load"}. {state.error}
          </span>
        ) : null}
      </header>
      <LatencyView rows={latency} />
      {data === null ? <p className="text-ink-dim">{state.stale ? "Nothing loaded yet." : "Loading…"}</p> : <Sections data={data} selectedMemoryId={selectedMemoryId} onSelectMemory={onSelectMemory} />}
    </section>
  );
}

const msText = (v: number | null) => (v === null ? "—" : `${Math.round(v)} ms`);

/** The last LatencyRow, the per-path p50 and p95, refusals and late turns (voice-control R18.2, R18.6, R18.7). */
function LatencyView({ rows }: { rows: readonly LatencyRow[] }) {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  const s = summarize(rows);
  return (
    <div className={box} data-testid="latency">
      <h3 className="mb-2 font-semibold">Latency</h3>
      <p data-testid="latency-last" className="text-xs">
        Last turn <span className={mono}>{last.turnId}</span> · path {last.path ?? "—"} · refused {last.refused ?? "—"} · verdict {last.verdict ?? "—"} · end of speech to audible {msText(last.endToAudibleMs)} · commit delay{" "}
        {msText(last.commitDelayMs)}
        {last.late ? " · late" : ""}
      </p>
      <table className="my-2 text-xs">
        <thead>
          <tr className="text-ink-dim">
            <th className="pr-3 text-left">path</th>
            <th className="pr-3 text-left">n</th>
            <th className="pr-3 text-left">p50</th>
            <th className="text-left">p95</th>
          </tr>
        </thead>
        <tbody>
          {s.byPath.map((p) => (
            <tr key={p.path} data-testid="latency-path">
              <td className="pr-3">{p.path}</td>
              <td className="pr-3">{p.n}</td>
              <td className="pr-3">{msText(p.p50)}</td>
              <td>{msText(p.p95)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p data-testid="latency-refused" className="text-xs">
        fastO refused: {s.refused.map((r) => `${r.reason} ${r.n}`).join(", ")} · late turns {s.late}
      </p>
    </div>
  );
}

/** The Session's audience and parses (voice-control R13.5). */
function AudienceView({ session }: { session: DebugSessionView | null }) {
  if (session === null) return null;
  return (
    <div className={box} data-testid="audience">
      <h3 className="mb-2 font-semibold">Audience</h3>
      <p className="text-xs">
        Audience {session.repairPending ? "unknown (repair pending)" : session.audience} · failed parses {session.failedParses}
      </p>
      {session.parseGapTurnId !== null ? (
        <p data-testid="parse-gap" className="text-xs text-brass">
          fastO off: parse gap at turn <span className={mono}>{session.parseGapTurnId}</span>
        </p>
      ) : null}
    </div>
  );
}

function Sections({ data, selectedMemoryId, onSelectMemory }: { data: DebugData; selectedMemoryId: string | null; onSelectMemory: (id: string | null) => void }) {
  const evidenceById = new Map<string, Evidence>(data.evidence.map((e) => [e.id, e.record]));
  const selected = data.memories.find((m) => m.id === selectedMemoryId) ?? null;
  const more = (s: string) => (data.truncated.includes(s as never) ? <p className="text-xs text-brass">More {s} exist than were loaded.</p> : null);
  return (
    <>
      <AudienceView session={data.session} />
      <div className={box}>
        <h3 className="mb-2 font-semibold">Turns</h3>
        {data.turns.length === 0 ? (
          <p className="text-ink-dim">No turns in the current Session.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-dim">
                <th className="text-left">seq</th>
                <th className="text-left">role</th>
                <th className="text-left">clientSeq</th>
                <th className="text-left">state</th>
                <th className="text-left">evidence</th>
                <th className="text-left">text</th>
              </tr>
            </thead>
            <tbody>
              {data.turns.map(({ id, record: t }) => (
                <tr key={id} data-testid="turn-row" data-seq={t.seq} data-role={t.role}>
                  <td>{t.seq}</td>
                  <td>{t.role}</td>
                  <td>{t.role === "user" ? t.seq : "—"}</td>
                  <td>{t.state}</td>
                  <td className={mono}>{t.evidenceId ?? <span data-testid="no-evidence" className="text-brass">none</span>}</td>
                  <td>{t.text ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {more("turns")}
      </div>

      <div className={box}>
        <h3 className="mb-2 font-semibold">Evidence</h3>
        {data.evidence.length === 0 ? <p className="text-ink-dim">No Evidence.</p> : null}
        <ul className="flex flex-col gap-1">
          {data.evidence.map(({ id, record: e }) => (
            <li key={id}>
              <span className={mono}>{id}</span> · {e.source} · {e.fieldSlices.map((s) => `${s.class}/${s.sens}`).join(", ")} · turn <span className={mono}>{e.turnId ?? "none"}</span>
              <pre className="whitespace-pre-wrap text-xs text-ink">{evidenceFieldText(e)}</pre>
            </li>
          ))}
        </ul>
        {more("evidence")}
      </div>

      <div className={box}>
        <h3 className="mb-2 font-semibold">Memories</h3>
        {data.memories.length === 0 ? <p className="text-ink-dim">No Memories.</p> : null}
        <ul className="flex flex-col gap-1">
          {data.memories.map(({ id, record: m, lineage }) => (
            <li key={id}>
              <button type="button" onClick={() => onSelectMemory(id === selectedMemoryId ? null : id)} className="text-left underline-offset-2 hover:underline" aria-pressed={id === selectedMemoryId}>
                {m.sayAs !== null ? <>{m.sayAs.text} · </> : null}
                {m.predicate}: <code>{JSON.stringify(m.value)}</code> · {m.status} · {m.sourceClass}/{m.sens}
              </button>
              {lineage.ok ? null : (
                <span data-testid="lineage-mismatch" className="ml-2 rounded bg-night-2 px-1 text-xs text-ember">
                  lineage mismatch
                </span>
              )}
            </li>
          ))}
        </ul>
        {selected !== null ? <MemoryDetail item={selected} evidenceById={evidenceById} /> : null}
        {more("memories")}
      </div>

      <div className={box}>
        <h3 className="mb-2 font-semibold">Extract jobs</h3>
        {data.jobs.length === 0 ? <p className="text-ink-dim">No jobs.</p> : null}
        <ul className="flex flex-col gap-1 text-xs">
          {data.jobs.map(({ id, record: j }) => {
            const src = jobSource(j, evidenceById);
            return (
              <li key={id} data-testid="job-row">
                <span className={mono}>{id}</span> · {j.kind} · turn <span className={mono}>{src.turnId ?? "unknown"}</span> (evidence <span className={mono}>{src.eid ?? "none"}</span>) · {j.status} · attempts {j.attempts}
                {j.error !== null ? <span className="ml-1 text-ember">error {j.error}</span> : null}
              </li>
            );
          })}
        </ul>
        {more("jobs")}
      </div>

      <div className={box}>
        <h3 className="mb-2 font-semibold">Admission and extraction decisions</h3>
        {data.ledger.length === 0 ? <p className="text-ink-dim">No decisions.</p> : null}
        <ul className="flex flex-col gap-2 text-xs">
          {decisionsByTurn(data.ledger).map((group, gi) => (
            <li key={group.turnId ?? `none-${gi}`} data-testid="decision-group">
              <p className="text-ink-dim">
                turn <span className={mono}>{group.turnId ?? "none"}</span>
              </p>
              <ul className="ml-3 flex flex-col gap-1">
                {group.items.map(({ id, record, issuer, permitKind, falseHold, played }) => {
                  // The validated record matches the Ledger union; its schema type keeps `payload` open.
                  const l = record as unknown as Ledger;
                  return (
                    <li key={id} data-testid="ledger-row" data-played={played ? "true" : "false"}>
                      {played ? <span className="mr-1 text-ecto">▶ played</span> : null}
                      {l.at} · {l.kind === "decision" ? l.payload.purpose : l.kind} · {l.state} · turn <span className={mono}>{ledgerTurnId(l) ?? "none"}</span> · permit{" "}
                      {permitKind ?? (l.state === "blocked" ? "hold" : "—")} · issuer {issuerLabel(issuer)}
                      {l.kind === "decision" ? <span> · audience {l.payload.audience}</span> : null}
                      {falseHold ? <span className="ml-1 text-brass">false hold</span> : null}
                      {permitKind === "postCommitControl" ? <span> · class: not recorded</span> : null}
                      {l.kind === "decision" && l.payload.reasonCodes.length > 0 ? <span> · reasons {l.payload.reasonCodes.join(", ")}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {more("ledger")}
      </div>

      <HeadView bundle={data.head} />
    </>
  );
}

function evidenceFieldText(e: Evidence): string {
  return e.text !== null && e.text.kind === "inline" ? e.text.text : "";
}

/** Fields of the selected Memory with where each came from, and its lineage (R29.3). */
function MemoryDetail({ item, evidenceById }: { item: DebugData["memories"][number]; evidenceById: ReadonlyMap<string, Evidence> }) {
  const m = item.record;
  const failedSlices = new Set(item.lineage.failures.map((f) => f.index));
  const model = "model proposal, checked by code against the cited spans";
  const fields: [string, string, string][] = [
    ["kind", m.kind, model],
    ["predicate", m.predicate, model],
    ["subjectId", m.subjectId, "code: resolved mention"],
    ["scopeId", m.scopeId, "code"],
    ["value", JSON.stringify(m.value), model],
    ["args", JSON.stringify(m.args), model],
    ["status", m.status, "code: Source_Class rule (KC04)"],
    ["sourceClass", m.sourceClass, "code: classes of the root Slices"],
    ["sens", m.sens, "code: max of proposal, lexicon floor and root Slices"],
    ["gravity", String(m.gravity), "code: max of proposal and lexicon floor"],
    ["flow", m.flow, "model proposal, only tightened"],
    ["key", m.key, "code: H(subject, predicate, scope)"],
    ["assertedAt", m.assertedAt, "worldClock"],
    ["validFrom", m.validFrom ?? "null", "worldClock"],
    ["createdAt", m.createdAt, "opsClock"],
  ];
  return (
    <div data-testid="memory-detail" className="mt-3 flex flex-col gap-3 border-t border-stitch pt-3">
      <table className="w-full text-xs">
        <tbody>
          {fields.map(([name, value, source]) => (
            <tr key={name}>
              <td className="pr-2 text-ink-dim">{name}</td>
              <td className={mono}>{value}</td>
              <td className="pl-2 text-ink-dim">{source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-xs">
        <p>
          dependsOn: <span className={mono}>{m.dependsOn.join(", ")}</span>
        </p>
        <p>
          supporting: <span className={mono}>{m.supportingIds.map((r) => `${r.type}:${r.id}@${r.rev}`).join(", ") || "none"}</span>
        </p>
      </div>
      <ol className="flex flex-col gap-2 text-xs">
        {item.lineage.links.map((link, i) => {
          const ev = evidenceById.get(link.slice.eid);
          const seg = highlight(ev, link.slice);
          const mismatch = failedSlices.has(i) || link.text === null || (seg !== null && seg.marked !== link.text);
          return (
            <li key={`${link.slice.eid}:${i}`} data-testid="lineage-link">
              <p>
                root {i}: evidence <span className={mono}>{link.slice.eid}</span> · {link.slice.fieldPath} [{link.slice.start}, {link.slice.end}) · {link.slice.class}/{link.slice.sens} · rootKey{" "}
                <span className={mono}>{m.rootKeys[i] ?? "missing"}</span>
                {mismatch ? (
                  <span data-testid="span-mismatch" className="ml-2 rounded bg-night-2 px-1 text-ember">
                    lineage mismatch
                  </span>
                ) : null}
              </p>
              {seg !== null ? (
                <pre className="whitespace-pre-wrap text-ink">
                  {seg.before}
                  <mark className="bg-gold text-night-0">{seg.marked}</mark>
                  {seg.after}
                </pre>
              ) : (
                <p className="text-ink-dim">{ev === undefined ? "Evidence not loaded." : "Range does not fit the Evidence text."}</p>
              )}
            </li>
          );
        })}
      </ol>
      {item.lineage.failures.length > 0 ? (
        <p className="text-xs text-ember">Failed links: {item.lineage.failures.map((f) => `${f.kind} at ${f.index}`).join(", ")}</p>
      ) : null}
    </div>
  );
}

/** The Head compiled at the most recent Session open (R29.5). */
function HeadView({ bundle }: { bundle: CoreBundle | null }) {
  const head = bundle?.head ?? null;
  if (bundle === null || head === null) {
    return (
      <div className={box} data-testid="no-head">
        <h3 className="mb-2 font-semibold">Head</h3>
        <p className="text-ink-dim">No Head compiled yet.</p>
      </div>
    );
  }
  const tokens = new Map(head.sections.map((s) => [s.id, s.tokens]));
  return (
    <div className={box} data-testid="head">
      <h3 className="mb-2 font-semibold">Head</h3>
      <p className="text-xs">
        {head.tokenCount} / {HEAD_CAP} tokens · headHash <span className={mono}>{bundle.headHash ?? "none"}</span> · compiled {bundle.compiledAt ?? "unknown"} · bundleRev {bundle.bundleRev}
      </p>
      <table className="my-2 text-xs">
        <tbody>
          {HEAD_SECTIONS.map((id) => (
            <tr key={id}>
              <td className="pr-2 text-ink-dim">{id}</td>
              <td>{tokens.get(id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs">
        selectedRefs: <span className={mono}>{head.selectedRefs.map((r) => `${r.type}:${r.id}@${r.rev}`).join(", ") || "none"}</span>
      </p>
      <pre className="mt-2 whitespace-pre-wrap text-xs text-ink">{head.text}</pre>
    </div>
  );
}
