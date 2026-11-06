import { HEAD_SECTIONS, type CoreBundle, type Evidence, type Ledger } from "@franki/core";
import { type DebugData, type DebugState, highlight, jobSource, ledgerTurnId } from "../client/debug-panel";

/**
 * The Debug_Panel (R21.9, R29.3–R29.8, R29.10). Presentational: data comes from `DebugPanelModel`. Every stored
 * string is rendered as a React text child, so stored HTML shows as literal text and never runs (R29.10).
 */
export interface DebugPanelProps {
  state: DebugState;
  selectedMemoryId: string | null;
  onSelectMemory: (id: string | null) => void;
  onRefresh: () => void;
}

const HEAD_CAP = 3500;
const box = "rounded border border-zinc-800 p-3 text-left";
const mono = "font-mono text-xs break-all";

export function DebugPanel({ state, selectedMemoryId, onSelectMemory, onRefresh }: DebugPanelProps) {
  const { data } = state;
  return (
    <section aria-label="Debug panel" className="flex w-full max-w-5xl flex-col gap-4 text-left text-sm text-zinc-200">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">Debug panel</h2>
        <button type="button" onClick={onRefresh} disabled={state.loading} className="rounded border border-zinc-600 px-2 py-0.5 text-xs disabled:opacity-50">
          {state.loading ? "Loading…" : "Refresh"}
        </button>
        {state.lastLoadedAt !== null ? <span className="text-xs text-zinc-500">Loaded at {state.lastLoadedAt}</span> : null}
        {state.stale ? (
          <span role="status" data-testid="stale" className="rounded bg-amber-900 px-2 py-0.5 text-xs text-amber-100">
            Stale: showing data from {state.lastLoadedAt ?? "no successful load"}. {state.error}
          </span>
        ) : null}
      </header>
      {data === null ? <p className="text-zinc-500">{state.stale ? "Nothing loaded yet." : "Loading…"}</p> : <Sections data={data} selectedMemoryId={selectedMemoryId} onSelectMemory={onSelectMemory} />}
    </section>
  );
}

function Sections({ data, selectedMemoryId, onSelectMemory }: { data: DebugData; selectedMemoryId: string | null; onSelectMemory: (id: string | null) => void }) {
  const evidenceById = new Map<string, Evidence>(data.evidence.map((e) => [e.id, e.record]));
  const selected = data.memories.find((m) => m.id === selectedMemoryId) ?? null;
  const more = (s: string) => (data.truncated.includes(s as never) ? <p className="text-xs text-amber-300">More {s} exist than were loaded.</p> : null);
  return (
    <>
      <div className={box}>
        <h3 className="mb-2 font-semibold">Turns</h3>
        {data.turns.length === 0 ? (
          <p className="text-zinc-500">No turns in the current Session.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500">
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
                  <td className={mono}>{t.evidenceId ?? <span data-testid="no-evidence" className="text-amber-300">none</span>}</td>
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
        {data.evidence.length === 0 ? <p className="text-zinc-500">No Evidence.</p> : null}
        <ul className="flex flex-col gap-1">
          {data.evidence.map(({ id, record: e }) => (
            <li key={id}>
              <span className={mono}>{id}</span> · {e.source} · {e.fieldSlices.map((s) => `${s.class}/${s.sens}`).join(", ")} · turn <span className={mono}>{e.turnId ?? "none"}</span>
              <pre className="whitespace-pre-wrap text-xs text-zinc-300">{evidenceFieldText(e)}</pre>
            </li>
          ))}
        </ul>
        {more("evidence")}
      </div>

      <div className={box}>
        <h3 className="mb-2 font-semibold">Memories</h3>
        {data.memories.length === 0 ? <p className="text-zinc-500">No Memories.</p> : null}
        <ul className="flex flex-col gap-1">
          {data.memories.map(({ id, record: m, lineage }) => (
            <li key={id}>
              <button type="button" onClick={() => onSelectMemory(id === selectedMemoryId ? null : id)} className="text-left underline-offset-2 hover:underline" aria-pressed={id === selectedMemoryId}>
                {m.sayAs !== null ? <>{m.sayAs.text} · </> : null}
                {m.predicate}: <code>{JSON.stringify(m.value)}</code> · {m.status} · {m.sourceClass}/{m.sens}
              </button>
              {lineage.ok ? null : (
                <span data-testid="lineage-mismatch" className="ml-2 rounded bg-red-900 px-1 text-xs text-red-100">
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
        {data.jobs.length === 0 ? <p className="text-zinc-500">No jobs.</p> : null}
        <ul className="flex flex-col gap-1 text-xs">
          {data.jobs.map(({ id, record: j }) => {
            const src = jobSource(j, evidenceById);
            return (
              <li key={id} data-testid="job-row">
                <span className={mono}>{id}</span> · {j.kind} · turn <span className={mono}>{src.turnId ?? "unknown"}</span> (evidence <span className={mono}>{src.eid ?? "none"}</span>) · {j.status} · attempts {j.attempts}
                {j.error !== null ? <span className="ml-1 text-red-300">error {j.error}</span> : null}
              </li>
            );
          })}
        </ul>
        {more("jobs")}
      </div>

      <div className={box}>
        <h3 className="mb-2 font-semibold">Admission and extraction decisions</h3>
        {data.ledger.length === 0 ? <p className="text-zinc-500">No decisions.</p> : null}
        <ul className="flex flex-col gap-1 text-xs">
          {data.ledger.map(({ id, record, issuer, permitKind }) => {
            // The validated record matches the Ledger union; its schema type keeps `payload` open.
            const l = record as unknown as Ledger;
            return (
              <li key={id} data-testid="ledger-row">
                {l.at} · {l.kind === "decision" ? l.payload.purpose : l.kind} · {l.state} · turn <span className={mono}>{ledgerTurnId(l) ?? "none"}</span> · permit {permitKind ?? "—"} · issuer {issuer ?? "—"}
                {l.kind === "decision" && l.payload.reasonCodes.length > 0 ? <span> · reasons {l.payload.reasonCodes.join(", ")}</span> : null}
              </li>
            );
          })}
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
    <div data-testid="memory-detail" className="mt-3 flex flex-col gap-3 border-t border-zinc-800 pt-3">
      <table className="w-full text-xs">
        <tbody>
          {fields.map(([name, value, source]) => (
            <tr key={name}>
              <td className="pr-2 text-zinc-500">{name}</td>
              <td className={mono}>{value}</td>
              <td className="pl-2 text-zinc-500">{source}</td>
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
                  <span data-testid="span-mismatch" className="ml-2 rounded bg-red-900 px-1 text-red-100">
                    lineage mismatch
                  </span>
                ) : null}
              </p>
              {seg !== null ? (
                <pre className="whitespace-pre-wrap text-zinc-300">
                  {seg.before}
                  <mark className="bg-yellow-300 text-zinc-900">{seg.marked}</mark>
                  {seg.after}
                </pre>
              ) : (
                <p className="text-zinc-500">{ev === undefined ? "Evidence not loaded." : "Range does not fit the Evidence text."}</p>
              )}
            </li>
          );
        })}
      </ol>
      {item.lineage.failures.length > 0 ? (
        <p className="text-xs text-red-300">Failed links: {item.lineage.failures.map((f) => `${f.kind} at ${f.index}`).join(", ")}</p>
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
        <p className="text-zinc-500">No Head compiled yet.</p>
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
              <td className="pr-2 text-zinc-500">{id}</td>
              <td>{tokens.get(id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs">
        selectedRefs: <span className={mono}>{head.selectedRefs.map((r) => `${r.type}:${r.id}@${r.rev}`).join(", ") || "none"}</span>
      </p>
      <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{head.text}</pre>
    </div>
  );
}
