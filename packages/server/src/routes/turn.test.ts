import { type Evidence, type Job, type Session, type Turn, TurnResponse, msFromTs, tsFromMs, utf8, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { insertTurnForTest } from "../testing/extract-fixtures";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnEvidenceId } from "../turns";
import { extractJobId } from "../worker/extract-jobs";
import { turnRoute } from "./turn";

const UID = "owner-1";

async function setup() {
  const rig = testRig();
  const s = await openTestSession(rig);
  const read = async <T>(path: string) => (await rig.store.get<T>(UID, path))?.data ?? null;
  const turnOf = (label: string | number) => read<Turn>(paths.turn(UID, s.sessionId, testId(`turn-${label}`)));
  const evidenceOf = (label: string | number) => read<Evidence>(paths.evidence(UID, turnEvidenceId(testId(`turn-${label}`), rig.deps.hasher)));
  const session = () => read<Session>(paths.session(UID, s.sessionId));
  return { rig, s, turnOf, evidenceOf, session, read };
}

describe("POST /api/turn (typed path)", () => {
  it("Turn+Evidence+Extract_Job atomic: an ordinary typed line is U with source voice and one Extract_Job", async () => {
    const { rig, s, turnOf, evidenceOf, session } = await setup();
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "My dog is called Pip"));
    expect(res.status).toBe(200);
    expect(validate(TurnResponse, res.body).ok).toBe(true);
    expect(res.body).toMatchObject({ status: "ordinary", stamp: { ...s.stamp, turnId: testId("turn-1") } });
    const turn = (await turnOf(1))!;
    const ev = (await evidenceOf(1))!;
    expect(turn).toMatchObject({ seq: 1, role: "user", sourceClass: "U", state: "committed", text: "My dog is called Pip", itemIds: [] });
    expect(ev).toMatchObject({ kind: "turn", source: "voice", turnId: testId("turn-1"), sessionId: s.sessionId, itemIds: [], text: { kind: "inline", text: "My dog is called Pip" } });
    expect(ev.fieldSlices).toEqual([expect.objectContaining({ fieldPath: "text", start: 0, end: 20, class: "U", sens: "S0" })]);
    expect(turn.evidenceId).toBe(turnEvidenceId(testId("turn-1"), rig.deps.hasher));
    const job = await rig.store.get<Job>(UID, paths.job(UID, extractJobId(turn.evidenceId!, rig.deps.hasher)));
    expect(job?.data).toMatchObject({ kind: "extract", status: "queued", epoch: 1, policyRev: 1, sourceIds: [turn.evidenceId] });
    expect(await session()).toMatchObject({ nextClientSeq: 2, lastClientSeq: 1, committedParseSeq: 1, status: "minting" });
  });

  it("Turn+Evidence+Extract_Job atomic: a failed commit stores none of them", async () => {
    const { rig, s, turnOf, evidenceOf } = await setup();
    const inner = rig.store;
    rig.deps.store = {
      get: (u, p) => inner.get(u, p),
      query: (u, q) => inner.query(u, q),
      transaction: (u, fn) =>
        inner.transaction(u, async (tx) => {
          let writesTurn = false;
          const r = await fn({ ...tx, get: tx.get, query: tx.query, update: tx.update, create: (p, rec) => ((writesTurn ||= p.includes("/turns/")), tx.create(p, rec)) });
          if (writesTurn) throw new Error("injected commit failure");
          return r;
        }),
    };
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "My dog is called Pip"));
    expect(res.status).toBe(503);
    expect(await turnOf(1)).toBeNull();
    expect(await evidenceOf(1)).toBeNull();
    expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(0);
  });

  describe("pasted classification (R18.2)", () => {
    it.each([
      ["over 280 code units", "a".repeat(281)],
      ["a line feed", "line one\nline two"],
      ["a carriage return", "line one\rline two"],
      ["From:", "From: boss@example.com hi"],
      ["Subject:", "Subject: hello"],
      ["a URL", "see https://example.com"],
      ["www.", "go to www.example.com"],
    ])("stores text with %s as pasted/T with no Extract_Job", async (_label, text) => {
      const { rig, s, turnOf, evidenceOf } = await setup();
      const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, text));
      expect(res.status).toBe(200);
      expect((await turnOf(1))?.sourceClass).toBe("T");
      const ev = (await evidenceOf(1))!;
      expect(ev.source).toBe("pasted");
      expect(ev.fieldSlices[0]!.class).toBe("T");
      expect(ev.text?.kind === "inline" && ev.text.text).not.toMatch(/\r/);
      expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(0);
    });

    it("normalizes CRLF and lone CR before offsets and hashes (R20.2)", async () => {
      const { rig, s, evidenceOf } = await setup();
      await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "a\r\nb\rc"));
      const ev = (await evidenceOf(1))!;
      expect(ev.text).toEqual({ kind: "inline", text: "a\nb\nc" });
      expect(ev.fieldSlices[0]).toMatchObject({ start: 0, end: 5, contentHash: rig.deps.hasher.sha256(utf8("a\nb\nc")) });
    });
  });

  describe("empty/oversize rejected (R18.8)", () => {
    it.each([
      ["an empty transcript", ""],
      ["a whitespace-only transcript", "   "],
      ["a transcript over 8192 code units", "a".repeat(8193)],
    ])("rejects %s with PARSE and stores nothing", async (_label, text) => {
      const { rig, s, turnOf, session } = await setup();
      const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, text));
      expect(res).toMatchObject({ status: 400, body: { error: "PARSE" } });
      expect(await turnOf(1)).toBeNull();
      expect((await session())!.nextClientSeq).toBe(1);
    });
  });

  describe("missing/failed transcript advances seq with no Evidence (R20.8)", () => {
    it.each(["missing", "failed"] as const)("commits a %s ASR Turn, advances nextClientSeq, writes no Evidence or job", async (state) => {
      const { rig, s, turnOf, evidenceOf, session } = await setup();
      const res = await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, "", [{ itemId: "item_1", commitSeq: 1 }], state));
      expect(res.status).toBe(200);
      expect(await turnOf(1)).toMatchObject({ state: state === "missing" ? "transcriptMissing" : "failed", evidenceId: null, text: null, seq: 1 });
      expect(await evidenceOf(1)).toBeNull();
      expect(rig.store.countUnder(paths.collection(UID, "jobs"))).toBe(0);
      expect((await session())!.nextClientSeq).toBe(2);
    });
  });

  it("stores voice item IDs in ascending commitSeq order (R19.8)", async () => {
    const { rig, s, turnOf, evidenceOf } = await setup();
    await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, "hello there", [
      { itemId: "item_c", commitSeq: 3 },
      { itemId: "item_a", commitSeq: 1 },
      { itemId: "item_b", commitSeq: 2 },
    ]));
    expect((await turnOf(1))!.itemIds).toEqual(["item_a", "item_b", "item_c"]);
    expect((await evidenceOf(1))!.itemIds).toEqual(["item_a", "item_b", "item_c"]);
  });

  describe("clientSeq (R19.2, R19.3, R19.10)", () => {
    it("holds a turn ahead of nextClientSeq with retryAfterMs 1–5000 and writes nothing, then commits on retry", async () => {
      const { rig, s, turnOf, session } = await setup();
      const early = await callRoute(rig, turnRoute, typedTurn(s.stamp, 2, "second"));
      expect(early.body.status).toBe("hold");
      expect(early.body.retryAfterMs).toBeGreaterThanOrEqual(1);
      expect(early.body.retryAfterMs).toBeLessThanOrEqual(5000);
      expect(await turnOf(2)).toBeNull();
      expect((await session())!.nextClientSeq).toBe(1);
      await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "first"));
      const retry = await callRoute(rig, turnRoute, typedTurn(s.stamp, 2, "second"));
      expect(retry.body.status).toBe("ordinary");
      expect((await turnOf(2))!.seq).toBe(2);
    });

    it("replays a recorded turn unchanged and writes no second Evidence (R19.3, R20.10)", async () => {
      const { rig, s } = await setup();
      const a = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
      const evidence = rig.store.countUnder(paths.collection(UID, "evidence"));
      rig.clock.advance(2_000);
      const b = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
      expect(b.body).toEqual(a.body);
      expect(rig.store.countUnder(paths.collection(UID, "evidence"))).toBe(evidence);
    });

    it("rejects a lower clientSeq with a new requestId, and the same requestId with a new body", async () => {
      const { rig, s, session } = await setup();
      await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hello"));
      const other = { ...typedTurn(s.stamp, 1, "hello", "x"), clientSeq: 1 };
      expect((await callRoute(rig, turnRoute, other)).body.error).toBe("STALE");
      expect((await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "changed"))).body.error).toBe("HASH");
      expect((await session())!.nextClientSeq).toBe(2);
    });
  });

  it("returns stale for an old Stamp and writes nothing", async () => {
    const { rig, s, turnOf } = await setup();
    const res = await callRoute(rig, turnRoute, typedTurn({ ...s.stamp, bundleRev: 0 }, 1, "hello"));
    expect(res.body.status).toBe("stale");
    expect(await turnOf(1)).toBeNull();
  });

  it("schedules extraction after the response instead of running it", async () => {
    const { rig, s } = await setup();
    const before = rig.sched.pending;
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "My dog is called Pip"));
    expect(rig.sched.pending).toBe(before + 1);
  });

  it("puts earlier S0/S1 Turns in the Deck as SafeTurns, never the current one or S2", async () => {
    const { rig, s } = await setup();
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "I like tea"));
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 2, "my diagnosis came back"));
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 3, "what now"));
    expect(res.body.deck.turns.map((t: { text: string }) => t.text)).toEqual(["I like tea"]);
  });

  it("gives the Deck earlier Turns in R19.6 order: the question, then Franki's replies by commit time, whatever their IDs", async () => {
    const { rig, s, turnOf } = await setup();
    await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "What's my favorite movie?"));
    const question = (await turnOf(1))!;
    const after = (ms: number) => tsFromMs(msFromTs(question.committedAt) + ms);
    // Franki's preamble and its answer after a recall share the question's seq (R21.5). Their IDs sort before the
    // question's and opposite to their commit order, the way Firestore's tie order put the answer before the
    // question in the Nov 6 live test; the model then answered the old question again. Only Turn text is read
    // here, so both reuse the question's Evidence.
    const reply = { seq: 1, role: "assistant" as const, evidenceId: question.evidenceId, sourceClass: "M" as const };
    await insertTurnForTest(rig.store, UID, s.sessionId, `${"-".repeat(42)}A`, { ...reply, text: "You haven't told me one yet.", committedAt: after(2_000) });
    await insertTurnForTest(rig.store, UID, s.sessionId, `${"-".repeat(42)}B`, { ...reply, text: "Let me check.", committedAt: after(1_000) });
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 2, "What's my dog's name?"));
    expect(res.body.deck.turns.map((t: { role: string; text: string }) => `${t.role}: ${t.text}`)).toEqual([
      "user: What's my favorite movie?",
      "assistant: Let me check.",
      "assistant: You haven't told me one yet.",
    ]);
  });

  it("rejects a Session of another Owner with SCOPE", async () => {
    const { rig, s } = await setup();
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "hi"), { token: "token:owner-2" });
    expect(res.body.error).toBe("SCOPE");
  });
});
