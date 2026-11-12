import { type CoreBundle, type DebugItem, type DebugPage, type DebugSection, type Evidence, type LatencyRow, emptyTimes, finishRow } from "@franki/core";
import { T0, sampleCoreDocs, sampleEvidence, sampleHead, sampleJob, sampleLedgerDecision, sampleMemory, sampleSlice, sampleTurn, testId } from "@franki/core/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApiCallOptions, ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import { type DebugState, DebugPanelModel, sortTurns } from "../client/debug-panel";
import { DebugPanel } from "./DebugPanel";

const TEXT = "My dog is called Pip";
const EID = testId("ev");
const evidence = (text = TEXT, eid = EID): Evidence =>
  sampleEvidence({ text: { kind: "inline", text }, fieldSlices: [sampleSlice({ eid, start: 0, end: text.length })] });

const pipSlice = sampleSlice({ eid: EID, start: 17, end: 20 });
const goodMemory: DebugItem = {
  kind: "memory",
  id: testId("mem-good"),
  record: sampleMemory({ rootSlices: [pipSlice], value: { kind: "text", text: "dog: Pip" } }),
  lineage: { ok: true, links: [{ slice: pipSlice, text: "Pip" }], failures: [] },
};
const badSlice = sampleSlice({ eid: EID, start: 3, end: 6 });
const badMemory: DebugItem = {
  kind: "memory",
  id: testId("mem-bad"),
  record: sampleMemory({ rootSlices: [badSlice] }),
  lineage: { ok: false, links: [{ slice: badSlice, text: null }], failures: [{ kind: "sliceHashMismatch", index: 0, eid: EID }] },
};

function bundleWith(head: CoreBundle["head"]): CoreBundle {
  const b = sampleCoreDocs().bundle;
  return head === null ? b : { ...b, state: "clean", bundleRev: 1, head, headHash: "a".repeat(64), compiledAt: T0, expiresAt: T0 };
}

const pageOf = (section: DebugSection, items: DebugItem[], session: DebugPage["session"] = null): DebugPage => ({
  section,
  items,
  nextCursor: null,
  coverage: { state: "complete", from: null, to: null, missingRanges: [], generation: 0 },
  session,
});

interface Store {
  turns: DebugItem[];
  evidence: DebugItem[];
  memories: DebugItem[];
  jobs: DebugItem[];
  ledger: DebugItem[];
  head: CoreBundle | null;
  session?: DebugPage["session"];
}

const baseStore = (): Store => ({
  turns: [
    { kind: "turn", id: testId("t2a"), record: sampleTurn({ seq: 2, role: "assistant", evidenceId: null, text: "Nice.", committedAt: "2026-11-03T12:00:02.000Z" }) },
    { kind: "turn", id: testId("t2u"), record: sampleTurn({ seq: 2, role: "user", text: "It barks", committedAt: "2026-11-03T12:00:01.000Z" }) },
    { kind: "turn", id: testId("t1u"), record: sampleTurn({ seq: 1, role: "user", text: TEXT }) },
    { kind: "turn", id: testId("t3m"), record: sampleTurn({ seq: 3, role: "user", state: "transcriptMissing", evidenceId: null, text: null }) },
  ],
  evidence: [{ kind: "evidence", id: EID, record: evidence() }],
  memories: [goodMemory, badMemory],
  jobs: [{ kind: "job", id: testId("job1"), record: sampleJob({ status: "retry", error: "DEPENDENCY", attempts: 1 }) }],
  ledger: [
    {
      kind: "ledger",
      id: testId("led1"),
      record: { ...sampleLedgerDecision(), payload: { purpose: "answer", acceptedRefs: [{ type: "turn", id: testId("t1u"), parentId: testId("ses"), rev: 1 }], heldRefs: [], reasonCodes: [], audience: "private" } },
      issuer: "seam",
      permitKind: "slowOrdinary",
      falseHold: false,
      turnId: testId("t1u"),
      played: true,
    },
  ],
  head: bundleWith(sampleHead()),
});

/** Answers GET /api/debug/memory from `store`; `fail()` makes the next calls fail. */
function fakeDebugApi(store: Store) {
  let failing: ApiResult<unknown> | null = null;
  const api: ApiClient = {
    async call<T>(_path: string, options: ApiCallOptions = {}) {
      if (failing !== null) return failing as ApiResult<T>;
      const section = options.query?.section as DebugSection;
      const items: DebugItem[] = section === "head" ? (store.head === null ? [] : [{ kind: "head", id: "bundle", record: store.head }]) : store[section];
      return { ok: true, status: 200, body: pageOf(section, items, section === "turns" ? (store.session ?? null) : null) } as ApiResult<T>;
    },
  };
  return { api, fail: (r: ApiResult<unknown>) => (failing = r) };
}

let t = 0;
const clock = createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: Date.parse(T0), now: () => t } });

async function loaded(store = baseStore()) {
  const f = fakeDebugApi(store);
  const model = new DebugPanelModel({ api: f.api, clock });
  await model.refresh();
  return { model, ...f };
}

/** Static markup with React's text-boundary comments removed, so assertions read as the visible text. */
const render = (state: DebugState, selected: string | null = null, latency: LatencyRow[] = []) =>
  renderToStaticMarkup(<DebugPanel state={state} selectedMemoryId={selected} onSelectMemory={() => {}} onRefresh={() => {}} latency={latency} />).replaceAll("<!-- -->", "");

describe("DebugPanel", () => {
  it("turns in seq order with 'none' marker", async () => {
    const { model } = await loaded();
    const html = render(model.getSnapshot());
    const rows = [...html.matchAll(/data-testid="turn-row" data-seq="(\d+)" data-role="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    // seq ascending; at equal seq the user Turn comes before the assistant Turn (R19.6, R21.9).
    expect(rows).toEqual(["1:user", "2:user", "2:assistant", "3:user"]);
    expect(html.match(/data-testid="no-evidence"[^>]*>none</g)).toHaveLength(2);
    expect(html).toContain("transcriptMissing");
    // Assistant Turns show no clientSeq.
    expect(html).toMatch(/data-role="assistant"><td>2<\/td><td>assistant<\/td><td>—<\/td>/);
    expect(sortTurns([...baseStore().turns] as never[]).length).toBe(4);
  });

  it("span highlight and mismatch marker", async () => {
    const { model } = await loaded();
    const s = model.getSnapshot();
    const good = render(s, testId("mem-good"));
    expect(good).toContain('data-testid="memory-detail"');
    expect(good).toMatch(/My dog is called <mark[^>]*>Pip<\/mark>/);
    expect(good).not.toContain('data-testid="span-mismatch"');
    expect(good).toContain("[17, 20)");

    const bad = render(s, testId("mem-bad"));
    expect(bad).toContain('data-testid="span-mismatch"');
    expect(bad).toContain("sliceHashMismatch at 0");
    // The list marks the failing Memory even when it is not selected.
    expect(render(s).match(/data-testid="lineage-mismatch"/g)).toHaveLength(1);
  });

  it("marks a span whose highlighted text differs from the resolved text", async () => {
    const store = baseStore();
    const drift: DebugItem = { ...goodMemory, id: testId("mem-drift"), lineage: { ok: true, links: [{ slice: pipSlice, text: "Rex" }], failures: [] } };
    store.memories = [drift];
    const { model } = await loaded(store);
    expect(render(model.getSnapshot(), testId("mem-drift"))).toContain('data-testid="span-mismatch"');
  });

  it("stale indicator after a failed fetch", async () => {
    t = 0;
    const { model, fail } = await loaded();
    const first = model.getSnapshot();
    expect(first.stale).toBe(false);
    expect(first.lastLoadedAt).toBe(T0);
    t = 7000;
    fail({ ok: false, kind: "timeout" });
    await model.refresh();
    const s = model.getSnapshot();
    // The last good data stays, marked stale with the time of that load (R29.8).
    expect(s).toMatchObject({ stale: true, lastLoadedAt: T0 });
    expect(s.data).toBe(first.data);
    const html = render(s);
    expect(html).toMatch(/data-testid="stale"[^>]*>Stale: showing data from 2026-11-03T12:00:00.000Z/);
    expect(html).toContain("over 3 seconds");
    expect(html).toContain("My dog is called Pip");

    fail({ ok: false, kind: "http", status: 500, error: "DEPENDENCY", retryAfterMs: 0 });
    await model.refresh();
    expect(render(model.getSnapshot())).toContain("DEPENDENCY");
  });

  it("stored HTML rendered as text", async () => {
    const store = baseStore();
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    store.evidence = [{ kind: "evidence", id: EID, record: evidence(evil) }];
    store.turns = [{ kind: "turn", id: testId("t1u"), record: sampleTurn({ text: evil }) }];
    store.head = bundleWith({ ...sampleHead(), text: `Head ${evil}` });
    const evilSlice = sampleSlice({ eid: EID, start: 0, end: 23 });
    store.memories = [{ ...goodMemory, record: sampleMemory({ rootSlices: [evilSlice], value: { kind: "text", text: evil } }), lineage: { ok: true, links: [{ slice: evilSlice, text: evil.slice(0, 23) }], failures: [] } }];
    const { model } = await loaded(store);
    const html = render(model.getSnapshot(), goodMemory.id);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;");
  });

  it("'no Head compiled' state", async () => {
    const store = baseStore();
    store.head = sampleCoreDocs().bundle;
    const { model } = await loaded(store);
    const html = render(model.getSnapshot());
    expect(html).toContain('data-testid="no-head"');
    expect(html).toContain("No Head compiled");

    store.head = null;
    const again = await loaded(store);
    expect(render(again.model.getSnapshot())).toContain("No Head compiled");
  });

  it("shows the compiled Head's sections, total against the cap, headHash and selectedRefs", async () => {
    const { model } = await loaded();
    const html = render(model.getSnapshot());
    expect(html).toContain('data-testid="head"');
    expect(html).toMatch(/4 \/ 3500 tokens/);
    expect(html).toContain("a".repeat(64));
    for (const id of ["persona", "policy", "rules", "now", "style", "people", "next72", "apply", "know", "openers"]) expect(html).toContain(`>${id}</td>`);
    expect(html).toContain("You are Franki.");
  });

  it("shows jobs with their Turn, status and error, and admission entries with turnId and Permit kind", async () => {
    const { model } = await loaded();
    const html = render(model.getSnapshot());
    const job = html.match(/data-testid="job-row"[\s\S]*?<\/li>/)![0];
    expect(job).toContain(testId("job1"));
    expect(job).toContain(testId("turn"));
    expect(job).toContain("retry");
    expect(job).toContain("error DEPENDENCY");
    const led = html.match(/data-testid="ledger-row"[\s\S]*?<\/li>/)![0];
    expect(led).toContain(testId("t1u"));
    expect(led).toContain("slowOrdinary");
    expect(led).toContain("seam");
  });

  it("a refresh during a load queues one more load", async () => {
    const f = fakeDebugApi(baseStore());
    let calls = 0;
    const api: ApiClient = { call: (p, o) => (calls++, f.api.call(p, o)) };
    const model = new DebugPanelModel({ api, clock });
    const a = model.refresh();
    const b = model.refresh();
    const c = model.refresh();
    await Promise.all([a, b, c]);
    // Six sections per load, two loads.
    expect(calls).toBe(12);
  });
});

// voice-control task 43: latency, audience and admission.
describe("DebugPanel for the judge in the call (voice-control R13.4, R13.5, R18.2, R18.6, R18.7)", () => {
  const row = (turnId: string, over: Partial<Parameters<typeof finishRow>[0]>): LatencyRow =>
    finishRow({ ...emptyTimes(testId(turnId)), lastLoud: 1_000, commit: 1_400, ...over });
  const latency: LatencyRow[] = [
    row("a", { path: "fastO", verdict: "O", audible: 2_100 }),
    row("b", { path: "fastO", verdict: "O", audible: 2_300 }),
    row("c", { path: "slow", verdict: "H", refused: "verdict", permitAt: 4_200, audible: 4_400 }),
    row("d", { path: "regenerated", verdict: "O", refused: "staleAck", audible: 3_000 }),
  ];

  it("the last LatencyRow with its path and refused reason; per-path p50 and p95; counts per refused reason and late turns", async () => {
    const { model } = await loaded();
    const html = render(model.getSnapshot(), null, latency);
    const last = html.match(/data-testid="latency-last"[\s\S]*?<\/p>/)![0];
    expect(last).toContain(testId("d"));
    expect(last).toContain("path regenerated");
    expect(last).toContain("refused staleAck");
    expect(last).toContain("end of speech to audible 2000 ms");
    const paths = html.match(/data-testid="latency-path"[\s\S]*?<\/tr>/g)!;
    expect(paths[0]).toMatch(/fastO<\/td><td[^>]*>2<\/td><td[^>]*>1100 ms<\/td><td>1300 ms</);
    expect(paths[2]).toMatch(/slow<\/td><td[^>]*>1<\/td><td[^>]*>3400 ms<\/td><td>3400 ms</);
    const refused = html.match(/data-testid="latency-refused"[\s\S]*?<\/p>/)![0];
    expect(refused).toContain("verdict 1");
    expect(refused).toContain("staleAck 1");
    expect(refused).toContain("hash 0");
    // Turn c's Permit came 2,800 ms after its commit: one late turn.
    expect(refused).toContain("late turns 1");
    // No rows, no latency block.
    expect(render(model.getSnapshot())).not.toContain('data-testid="latency"');
  });

  it("audience, repair pending, failed parses and 'fastO off: parse gap' with the turn", async () => {
    const session = { sessionId: testId("ses"), audience: "private" as const, repairPending: true, failedParses: 2, parseGapTurnId: testId("t3m") };
    const { model } = await loaded({ ...baseStore(), session });
    expect(model.getSnapshot().data!.session).toEqual(session);
    const html = render(model.getSnapshot());
    const block = html.match(/data-testid="audience"[\s\S]*?<\/div>/)![0];
    expect(block).toContain("Audience unknown (repair pending) · failed parses 2");
    expect(block).toContain(`fastO off: parse gap at turn <span class="font-mono text-xs break-all">${testId("t3m")}</span>`);

    const { model: clean } = await loaded({ ...baseStore(), session: { ...session, repairPending: false, failedParses: 0, parseGapTurnId: null, audience: "company" } });
    const cleanHtml = render(clean.getSnapshot());
    expect(cleanHtml).toContain("Audience company · failed parses 0");
    expect(cleanHtml).not.toContain("parse gap");
  });

  it("decisions grouped by turn with the played one marked, the false hold shown, issuer seam or browser, and no devAdmit text", async () => {
    const decision = (label: string, turn: string, over: Record<string, unknown>) =>
      ({
        kind: "ledger",
        id: testId(label),
        record: { ...sampleLedgerDecision(), payload: { purpose: "answer", acceptedRefs: [{ type: "turn", id: testId(turn), parentId: testId("ses"), rev: 1 }], heldRefs: [], reasonCodes: [], audience: "private" } },
        issuer: "seam",
        permitKind: "slowOrdinary",
        falseHold: false,
        turnId: testId(turn),
        played: false,
        ...over,
      }) as DebugItem;
    const ledger = [
      decision("d1", "t1u", { issuer: "browser", permitKind: "fastO", played: true }),
      decision("d2", "t2u", { falseHold: true, played: true }),
      decision("d3", "t1u", {}),
    ];
    const { model } = await loaded({ ...baseStore(), ledger });
    const html = render(model.getSnapshot());
    const groups = html.match(/data-testid="decision-group"[\s\S]*?<\/ul><\/li>/g)!;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain(testId("t1u"));
    expect(groups[0]!.match(/data-testid="ledger-row"/g)).toHaveLength(2);
    expect(groups[0]).toMatch(/data-played="true">[^]*?▶ played[^]*?issuer browser \(fastO\)/);
    expect(groups[0]).toMatch(/data-played="false">[^]*?permit slowOrdinary · issuer seam/);
    expect(groups[1]).toContain("false hold");
    expect(html).not.toContain("devAdmit");
  });

  it("escapes stored text in the new blocks", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const session = { sessionId: testId("ses"), audience: "private" as const, repairPending: false, failedParses: 0, parseGapTurnId: null };
    const { model } = await loaded({ ...baseStore(), session });
    const html = render(model.getSnapshot(), null, [row("e", { path: "fastO", turnId: evil, audible: 2_000 })]);
    expect(html).not.toContain(evil);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("DebugPanel, Realtime errors (review of wave A, item 15)", () => {
  it("shows the count of Realtime error events by the client event they name, and the last code", async () => {
    const { model } = await loaded();
    const errors = { n: 3, judge: 1, spec: 2, speech: 0, other: 0, lastCode: "conversation_already_has_active_response" };
    const html = renderToStaticMarkup(<DebugPanel state={model.getSnapshot()} selectedMemoryId={null} onSelectMemory={() => {}} onRefresh={() => {}} realtimeErrors={errors} />).replaceAll("<!-- -->", "");
    const block = html.match(/data-testid="realtime-errors"[\s\S]*?<\/p>/)![0];
    expect(block).toContain("Realtime errors 3: judge 1, spec 2, reply 0, other 0");
    expect(block).toContain("last conversation_already_has_active_response");
    // None yet: the line still shows 0, so the live check can read it.
    const none = renderToStaticMarkup(<DebugPanel state={model.getSnapshot()} selectedMemoryId={null} onSelectMemory={() => {}} onRefresh={() => {}} />).replaceAll("<!-- -->", "");
    expect(none).toContain("Realtime errors 0");
  });
});
