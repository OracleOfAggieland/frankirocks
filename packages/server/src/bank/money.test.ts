// Brief 046 part C: read_money end to end on the routes, with the fake bank and faked models.
import { type Ledger, type Session, TurnResponse, ToolResponse, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { OWNER, bankRig, connectVia, connectorIdOf } from "../testing/bank-rig";
import { page, plaidError, txn } from "../testing/fake-bank";
import { callRoute, patchRecord } from "../testing/fakes";
import { asrTurn, openTestSession, typedTurn } from "../testing/session-fixtures";
import { bankDisconnectRoute, bankSyncRoute } from "./routes";
import { moneyArgsOf } from "../routes/typed-reply";

const THIS_MONTH = { period: "this_month", group: null, merchant: null } as const;

/** The rows the tests read: Nov 1 and 2, 2026 (the rig's clock is Nov 3, 12:00 UTC). */
function rows() {
  return [
    txn("g1", { amount: 42.5, date: "2026-11-01", authorized_date: "2026-11-01", merchant_name: "Green Grocer", personal_finance_category: { detailed: "FOOD_AND_DRINK_GROCERIES" } }),
    txn("c1", { amount: 4.25, date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Corner Cafe", personal_finance_category: { detailed: "FOOD_AND_DRINK_COFFEE" } }),
    txn("t1", { amount: 500, date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Savings", personal_finance_category: { detailed: "TRANSFER_OUT_SAVINGS" } }),
    txn("cc", { amount: 300, date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Card Payment", personal_finance_category: { detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" } }),
    txn("pay", { amount: -2000, date: "2026-11-01", authorized_date: "2026-11-01", merchant_name: "Employer", personal_finance_category: { detailed: "INCOME_SALARY" } }),
    txn("ref", { amount: -10, date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Online Store", personal_finance_category: { detailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES" } }),
    txn("pend", { amount: 99, pending: true, date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Hotel", personal_finance_category: { detailed: "TRAVEL_LODGING" } }),
    txn("cad", { amount: 15, iso_currency_code: "CAD", date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Maple Shop", personal_finance_category: null }),
    txn("old", { amount: 77, date: "2026-10-20", authorized_date: "2026-10-20", merchant_name: "October Shop", personal_finance_category: null }),
  ];
}

async function connected(over: { pull?: boolean } = {}) {
  const h = bankRig();
  h.bank.pages = [page({ added: rows() })];
  expect((await connectVia(h.rig, 1, over)).status).toBe(200);
  return h;
}

/** Opens a session and commits one owner turn by voice (judge O) or typed; answers the stamp for a tool call. */
async function ownerTurn(rig: ReturnType<typeof bankRig>["rig"], words: string, how: "voice" | "voiceUncertain" | "typed" = "voice") {
  const s = await openTestSession(rig);
  const body = how === "typed" ? typedTurn(s.stamp, 1, words) : { ...asrTurn(s.stamp, 1, words, [{ itemId: "item_1", commitSeq: 1 }]), judge: how === "voice" ? "O" : "timeout" };
  if (how === "typed") rig.openai.script("responses.create", ok({ status: "completed", outputText: "All right.", refusal: null, usage: { inputTokens: 0, outputTokens: 0 } }));
  const turn = await callRoute(rig, turnRoute, body);
  expect(turn.status).toBe(200);
  return { sessionId: s.sessionId, stamp: { ...s.stamp, turnId: testId("turn-1") } };
}

async function readMoneyTool(rig: ReturnType<typeof bankRig>["rig"], stamp: unknown, args: unknown = THIS_MONTH, n = 1) {
  const res = await callRoute(rig, toolRoute, { requestId: testId(`money-${n}`), stamp, callId: `call_${n}`, tool: { name: "read_money", args } });
  expect(res.status).toBe(200);
  expect(validate(ToolResponse, res.body).ok).toBe(true);
  return res.body;
}

async function gateRows(rig: ReturnType<typeof bankRig>["rig"]) {
  return (await rig.store.query<Ledger>(OWNER, { collection: paths.collection(OWNER, "ledger"), where: [{ field: "kind", op: "==", value: "gate" }], orderBy: { field: "at", dir: "desc" }, limit: 100 })).map((d) => d.data);
}

const texts = (body: { result: { notes: { text: string }[] } }) => body.result.notes.map((n) => n.text);

describe("read_money by voice (POST /api/tool)", () => {
  it("the owner asked in private: one S1 note with the dates, the total, the top merchants, money back and what was left out", async () => {
    const { rig } = await connected();
    const { stamp } = await ownerTurn(rig, "What did I spend this month?");
    const body = await readMoneyTool(rig, stamp);
    expect(body.status).toBe("ready");
    expect(body.result.state).toBe("answered");
    expect(texts(body)).toEqual([
      "From November 1 to November 3: $46.75 spent across 2 purchases. Top: Green Grocer $42.50; Corner Cafe $4.25. Money back: $10.00 across 1 refund or credit. Not counted: 1 pending charge, 1 charge in another currency. The bank was read just now.",
    ]);
    const note = body.result.notes[0];
    expect(note.sens).toBe("S1");
    // Lineage: the two purchases, the refund, the pending and the CAD row; never the transfer, card payment or pay.
    expect(note.dependsOn).toHaveLength(5);
    expect(note.rootKeys).toHaveLength(5);
    expect(body.permit).not.toBeNull();
    expect(await gateRows(rig)).toEqual([]);
  });

  it("a group and a merchant the owner named narrow the answer", async () => {
    const { rig } = await connected();
    const { stamp } = await ownerTurn(rig, "How much did I spend at Green Grocer on groceries this month?");
    const body = await readMoneyTool(rig, stamp, { period: "this_month", group: "groceries", merchant: "Green Grocer" });
    expect(texts(body)[0]).toMatch(/^From November 1 to November 3: \$42\.50 spent across 1 purchase\./);
  });

  it("a merchant the owner never said gives no total", async () => {
    const { rig } = await connected();
    const { stamp } = await ownerTurn(rig, "What did I spend this month?");
    const body = await readMoneyTool(rig, stamp, { period: "this_month", group: null, merchant: "Corner Cafe" });
    expect(body.result.state).toBe("unclear");
    expect(texts(body).join(" ")).not.toMatch(/\d/);
  });

  it("with company: nothing with an amount goes out, one line says it is held, and the Gate row is written", async () => {
    const { rig } = await connected();
    const { sessionId, stamp } = await ownerTurn(rig, "What did I spend this month?");
    await patchRecord<Session>(rig.store, OWNER, paths.session(OWNER, sessionId), { audience: "company" });
    const body = await readMoneyTool(rig, stamp);
    expect(body.result.state).toBe("held");
    expect(JSON.stringify(body.result.notes.map((n: { text: string }) => n.text))).not.toMatch(/\d/);
    expect(body.result.notes.every((n: { sens: string }) => n.sens === "S0")).toBe(true);
    const rows = await gateRows(rig);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ payload: { audience: "company", turnId: stamp.turnId } });
  });

  it("not asked (no money words) or an uncertain speaker: held, with the Gate row", async () => {
    const { rig } = await connected();
    const { stamp } = await ownerTurn(rig, "Tell me something nice.");
    const body = await readMoneyTool(rig, stamp);
    expect(body.result.state).toBe("held");
    expect((await gateRows(rig))[0]).toMatchObject({ payload: { verdict: "silent", reasonCodes: ["notAsked"] } });

    const h2 = await connected();
    const t2 = await ownerTurn(h2.rig, "What did I spend this month?", "voiceUncertain");
    const b2 = await readMoneyTool(h2.rig, t2.stamp);
    expect(b2.result.notes.every((n: { sens: string }) => n.sens === "S0")).toBe(true);
    expect(JSON.stringify(texts(b2))).not.toMatch(/\$/);
  });

  it("no bank connected: one line and the connect card, never the persona's rows", async () => {
    const { rig } = bankRig();
    const { stamp } = await ownerTurn(rig, "What did I spend this month?");
    const body = await readMoneyTool(rig, stamp);
    expect(body.result.state).toBe("noBank");
    expect(body.result.cards).toHaveLength(1);
    expect(body.result.cards[0]).toMatchObject({ kind: "source", sens: "S0" });
    expect(JSON.stringify(body.result)).not.toMatch(/\$/);
  });

  it("a disconnected bank's rows are never read", async () => {
    const { rig } = await connected();
    expect((await callRoute(rig, bankDisconnectRoute, { requestId: testId("dc"), connectorId: connectorIdOf(rig) })).status).toBe(200);
    const { stamp } = await ownerTurn(rig, "What did I spend this month?");
    expect((await readMoneyTool(rig, stamp)).result.state).toBe("noBank");
  });

  it("a revised row counts once at its newest revision, and a removed row not at all", async () => {
    const h = await connected();
    h.bank.pages = [page({ modified: [txn("g1", { amount: 50, date: "2026-11-01", authorized_date: "2026-11-01", merchant_name: "Green Grocer", personal_finance_category: { detailed: "FOOD_AND_DRINK_GROCERIES" } })], removed: [{ transaction_id: "c1" }] })];
    await callRoute(h.rig, bankSyncRoute, { connectorId: connectorIdOf(h.rig) });
    const { stamp } = await ownerTurn(h.rig, "What did I spend this month?");
    expect(texts(await readMoneyTool(h.rig, stamp))[0]).toMatch(/^From November 1 to November 3: \$50\.00 spent across 1 purchase\./);
  });

  it("pending, then posted: only the posted row counts", async () => {
    const h = await connected();
    h.bank.pages = [page({ added: [txn("pend-posted", { amount: 99, pending: false, pending_transaction_id: "pend", date: "2026-11-02", authorized_date: "2026-11-02", merchant_name: "Hotel", personal_finance_category: { detailed: "TRAVEL_LODGING" } })], removed: [{ transaction_id: "pend" }] })];
    await callRoute(h.rig, bankSyncRoute, { connectorId: connectorIdOf(h.rig) });
    const { stamp } = await ownerTurn(h.rig, "What did I spend this month?");
    const line = texts(await readMoneyTool(h.rig, stamp))[0]!;
    expect(line).toMatch(/\$145\.75 spent across 3 purchases/);
    expect(line).not.toMatch(/pending/);
  });

  it("a bank last read over an hour ago is pulled first, inside the budget", async () => {
    const h = await connected();
    h.rig.clock.advance(2 * 3_600_000);
    const before = h.bank.calls.filter((c) => c.method === "sync").length;
    const { stamp } = await ownerTurn(h.rig, "What did I spend this month?");
    const body = await readMoneyTool(h.rig, stamp);
    expect(h.bank.calls.filter((c) => c.method === "sync").length).toBe(before + 1);
    expect(texts(body)[0]).toMatch(/The bank was read just now\.$/);
  });

  it("a failed pull answers from what is stored and says how old it is", async () => {
    const h = await connected();
    h.rig.clock.advance(3 * 3_600_000);
    h.bank.failNext("sync", plaidError("INTERNAL_SERVER_ERROR", false));
    const { stamp } = await ownerTurn(h.rig, "What did I spend this month?");
    const body = await readMoneyTool(h.rig, stamp);
    expect(body.result.state).toBe("answered");
    expect(texts(body)[0]).toMatch(/\$46\.75 spent.*The bank was last read 3 hours ago\.$/);
  });

  it("a pull that does not finish in time answers from what is stored, within the route's limit", async () => {
    const h = await connected();
    h.rig.clock.advance(2 * 3_600_000);
    h.bank.sync = async () => {
      await h.rig.timers.sleep(60_000);
      return page();
    };
    const { stamp } = await ownerTurn(h.rig, "What did I spend this month?");
    const res = await callRoute(h.rig, toolRoute, { requestId: testId("money-late"), stamp, callId: "call_late", tool: { name: "read_money", args: THIS_MONTH } });
    expect(res.elapsedMs).toBeLessThanOrEqual(4_500);
    expect(res.body.result.state).toBe("answered");
    expect(res.body.result.notes[0].text).toMatch(/The bank was last read 2 hours ago\./);
  });

  it("nothing stored yet while the first import runs: the bank is still being read", async () => {
    const h = bankRig();
    h.bank.pages = [page({ added: [], updateStatus: "NOT_READY" })];
    expect((await connectVia(h.rig, 1, { pull: false })).status).toBe(200);
    const { stamp } = await ownerTurn(h.rig, "What did I spend this month?");
    const body = await readMoneyTool(h.rig, stamp);
    expect(body.result.state).toBe("importing");
    // A never-read bank is stale, so the read pulled it.
    expect(h.bank.calls.filter((c) => c.method === "sync")).toHaveLength(1);
  });

  it("closed arguments: an amount or an unknown period is PARSE", async () => {
    const { rig } = await connected();
    const { stamp } = await ownerTurn(rig, "What did I spend this month?");
    for (const args of [{ ...THIS_MONTH, amount: 5 }, { ...THIS_MONTH, period: "forever" }, { period: "this_month" }]) {
      const res = await callRoute(rig, toolRoute, { requestId: testId("bad"), stamp, callId: "c", tool: { name: "read_money", args } });
      expect(res.status).toBe(400);
    }
  });
});

describe("read_money on a typed turn (the typed reply path)", () => {
  const ask = (args: unknown) => normalizeResponse({ status: "completed", output: [{ type: "function_call", status: "completed", name: "read_money", arguments: JSON.stringify(args) }] });

  it("the brain model asks for the read; the turn commits, then the notes are read, gated and admitted, and a replay answers the same", async () => {
    const { rig } = await connected();
    const s = await openTestSession(rig);
    rig.openai.script("responses.create", ok(ask(THIS_MONTH)));
    const req = typedTurn(s.stamp, 1, "What did I spend this month?");
    const res = await callRoute(rig, turnRoute, req);
    expect(res.status).toBe(200);
    expect(validate(TurnResponse, res.body).ok).toBe(true);
    expect(res.body.pendingId).toBeNull();
    expect(res.body.permit).not.toBeNull();
    expect(res.body.notes.map((n: { text: string }) => n.text)[0]).toMatch(/^From November 1 to November 3: \$46\.75 spent/);
    expect((await callRoute(rig, turnRoute, req)).body).toEqual(res.body);
    // The typed path offers the money read alongside phone actions and results.
    const sent = rig.openai.requests.find((c) => c.endpoint === "responses.create")!.body as { tools: { name: string; description: string }[] };
    expect(sent.tools.map((t) => t.name)).toEqual(["make_phone_call", "read_money", "read_phone_result"]);
    expect(sent.tools[1]!.description).toMatch(/only when the user asks about their own spending/);
    expect(sent.tools[1]!.description).toMatch(/Never state an amount that the tool did not return/);
  });

  it("with company, a typed money question shows no amount", async () => {
    const { rig } = await connected();
    const s = await openTestSession(rig);
    await patchRecord<Session>(rig.store, OWNER, paths.session(OWNER, s.sessionId), { audience: "company" });
    rig.openai.script("responses.create", ok(ask(THIS_MONTH)));
    const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, "What did I spend this month?"));
    expect(JSON.stringify(res.body.notes)).not.toMatch(/\$/);
  });

  it("arguments that do not parse as the closed shape ask for nothing", () => {
    expect(moneyArgsOf(JSON.stringify(THIS_MONTH))).toEqual(THIS_MONTH);
    expect(moneyArgsOf(JSON.stringify({ ...THIS_MONTH, total: 100 }))).toBeNull();
    expect(moneyArgsOf("{")).toBeNull();
  });
});
