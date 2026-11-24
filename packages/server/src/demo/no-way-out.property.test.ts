/**
 * No way out (brief 054 design, correctness property 6; R14.2, R14.3, R14.4, R14.7, R14.8, R16.3). 1,000 runs.
 *   FOR ALL sequences of tool calls (`make_phone_call`, `read_money` with any MoneyArgs, `start_errand` with any
 *   `about`, `read_phone_result`, `search_web`) and route calls (bank link-token, connect and disconnect; Google start,
 *   connect and disconnect), made as an anonymous visitor on a cloned demo visit, over a deployment that has Twilio,
 *   Plaid and Google all configured, and whose dial and live ports are recorders:
 *   the recorders hold no call, no `phoneCall` row is written, the six provider routes each answer 404 SCOPE, and the
 *   specialist catalog reports the phone unavailable; with every scheduled run (errands, searches) carried out.
 * The phone half rests on `phone/outbound.ts` (part C4's `placePhoneCall` refusal).
 */
import { type Ledger, type MoneyArgs, MONEY_GROUPS, MONEY_PERIODS, type Stamp } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bankConnectRoute, bankDisconnectRoute, bankLinkTokenRoute } from "../bank/routes";
import { specialistCatalog } from "../errands/agent";
import { googleConnectRoute, googleDisconnectRoute, googleStartRoute } from "../google/routes";
import { ok } from "../openai/fake";
import { normalizeResponse } from "../openai/live";
import { openRoute } from "../routes/open";
import { toolRoute } from "../routes/tool";
import { turnRoute } from "../routes/turn";
import { paths } from "../store/paths";
import { ANON, DEMO_ENV, DEMO_FIXTURES, VISITOR, demoRig, resetDemo } from "../testing/demo-fixture";
import { BANK_ENV } from "../testing/fake-bank";
import { GOOGLE_TEST_ENV } from "../testing/fake-google";
import { callRoute, runScheduled } from "../testing/fakes";
import { asrTurn, currentVisit } from "../testing/session-fixtures";
import { demoBankConnectorId } from "./visit";

const RUNS = { numRuns: 1000 };
const TWILIO = { TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32), TWILIO_AUTH_TOKEN: "test-token", TWILIO_PHONE_NUMBER: "+14155550100", OPENAI_PROJECT_ID: "proj_test", OPENAI_WEBHOOK_SECRET: "test-secret", FRANKI_PHONE_REPORT_ORIGIN: "https://frankirocks.com" };
const ENV = { ...DEMO_ENV, ...BANK_ENV, ...GOOGLE_TEST_ENV, ...TWILIO };

const moneyArgs: fc.Arbitrary<MoneyArgs> = fc.record({
  period: fc.constantFrom(...MONEY_PERIODS),
  group: fc.option(fc.constantFrom(...MONEY_GROUPS), { nil: null }),
  merchant: fc.option(fc.constantFrom("Orbit Fuel Depot", "rocket fuel", "Moon Noodle Bar", "sandwich"), { nil: null }),
});

type Act =
  | { k: "tool"; name: "make_phone_call" | "read_phone_result"; args: Record<string, never> }
  | { k: "tool"; name: "read_money"; args: MoneyArgs }
  | { k: "tool"; name: "start_errand"; args: { about: ("mail" | "calendar")[] } }
  | { k: "tool"; name: "search_web"; args: { query: string; local: boolean; location: string | null } }
  | { k: "route"; route: "bankLinkToken" | "bankConnect" | "bankDisconnect" | "googleStart" | "googleConnect" | "googleDisconnect" };

const act: fc.Arbitrary<Act> = fc.oneof(
  fc.constantFrom<Act>({ k: "tool", name: "make_phone_call", args: {} }, { k: "tool", name: "read_phone_result", args: {} }),
  moneyArgs.map((args): Act => ({ k: "tool", name: "read_money", args })),
  fc.constantFrom<("mail" | "calendar")[]>(["mail"], ["calendar"], ["mail", "calendar"], ["calendar", "mail"]).map((about): Act => ({ k: "tool", name: "start_errand", args: { about } })),
  fc.record({ query: fc.constantFrom("rocket launch schedule", "weather on the moon"), local: fc.boolean() }).map((a): Act => ({ k: "tool", name: "search_web", args: { ...a, location: a.local ? "Houston" : null } })),
  fc.constantFrom<Act>(
    { k: "route", route: "bankLinkToken" },
    { k: "route", route: "bankConnect" },
    { k: "route", route: "bankDisconnect" },
    { k: "route", route: "googleStart" },
    { k: "route", route: "googleConnect" },
    { k: "route", route: "googleDisconnect" },
  ),
);

const WORDS: Record<string, string> = {
  make_phone_call: "Call +1 (415) 555-0123 and ask when the shop opens.",
  read_phone_result: "What did they say on the phone?",
  read_money: "How much did I spend on rocket fuel this month?",
  start_errand: "Check my mail for anything from mission control, and what's on my calendar today?",
  search_web: "Look up when the next rocket launch is.",
};

/** The planner and every other model request: one tool step, then nothing found. Never reaches a provider itself. */
function scriptModels(rig: ReturnType<typeof demoRig>["rig"]) {
  let n = 0;
  rig.openai.respond("responses.create", (body) => {
    const name = (body as { text?: { format?: { name?: string } } } | null)?.text?.format?.name;
    if (name !== "ErrandResultV1") return { kind: "error", error: new Error("no other model output in this test") };
    n++;
    const input = JSON.stringify((body as { input?: unknown }).input ?? []);
    if (!input.includes("function_call_output")) {
      const call = n % 2 === 0 ? { name: "list_events", arguments: JSON.stringify({ when: "today", part: null }) } : { name: "search_mail", arguments: JSON.stringify({ from: "mission control", words: [], when: null, unread: false }) };
      return ok(normalizeResponse({ status: "completed", output: [{ type: "function_call", status: "completed", call_id: `call_${n}`, ...call }] } as never));
    }
    return ok(normalizeResponse({ status: "completed", output_text: JSON.stringify({ outcome: "nothing", lines: [] }), output: [] } as never));
  });
}

const ROUTE_BODIES = {
  bankLinkToken: [bankLinkTokenRoute, {}],
  bankConnect: [bankConnectRoute, { requestId: testId("nwo-bank-connect"), publicToken: "public-sandbox-x" }],
  bankDisconnect: [bankDisconnectRoute, { requestId: testId("nwo-bank-disconnect"), connectorId: "" }],
  googleStart: [googleStartRoute, {}],
  googleConnect: [googleConnectRoute, { requestId: testId("nwo-google-connect"), code: "4/0AQSTgQ-test-code", state: "a".repeat(43) }],
  googleDisconnect: [googleDisconnectRoute, { requestId: testId("nwo-google-disconnect") }],
} as const;

describe("a demo visit can't reach outside", () => {
  it("places no dial and makes no live provider call, whatever it asks", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...DEMO_FIXTURES), fc.array(act, { minLength: 1, maxLength: 4 }), async (fixture, acts) => {
        const { rig, live } = demoRig(ENV);
        const dials: string[] = [];
        rig.deps.dial = async (_c, to) => {
          dials.push(to);
          return "CA" + "a".repeat(32);
        };
        scriptModels(rig);
        expect((await resetDemo(rig, fixture.id)).status).toBe(200);
        const open = await callRoute(rig, openRoute, { requestId: testId("nwo-open"), initiator: "user", previousSessionId: null, clientZone: "UTC", visitId: await currentVisit(rig, VISITOR) }, { token: ANON });
        expect(open.status).toBe(200);
        const stamp0 = { sessionId: open.body.sessionId, epoch: open.body.deck.epoch, policyRev: open.body.deck.policyRev, bundleRev: open.body.deck.bundleRev, rulesRev: open.body.deck.rulesRev, generation: 1 };

        for (const [i, a] of acts.entries()) {
          if (a.k === "route") {
            const [spec, body] = ROUTE_BODIES[a.route];
            const b = a.route === "bankDisconnect" ? { ...body, connectorId: demoBankConnectorId(rig.deps.hasher, VISITOR) } : body;
            const res = await callRoute(rig, spec as never, b, { token: ANON });
            expect(res.status).toBe(404);
            expect(res.body).toStrictEqual({ error: "SCOPE", retryAfterMs: 0 });
            continue;
          }
          const seq = i + 1;
          const turn = await callRoute(rig, turnRoute, { ...asrTurn(stamp0, seq, WORDS[a.name]!, [{ itemId: `nwo-${seq}`, commitSeq: seq }], "final", `nwo-${seq}`), judge: "O" }, { token: ANON });
          expect(turn.status).toBe(200);
          const stamp = turn.body.stamp as Stamp;
          const res = await callRoute(rig, toolRoute, { requestId: testId(`nwo-tool-${seq}`), stamp, callId: `tool${seq}`, tool: { name: a.name, args: a.args } }, { token: ANON });
          expect([200, 409]).toContain(res.status);
        }
        await runScheduled(rig);

        const catalog = await specialistCatalog({ uid: VISITOR, deps: rig.deps, schedule: rig.sched.schedule, anonymous: true, origin: "https://frankirocks.com" } as never);
        expect(catalog.phone).toBe("unavailable");
        expect(dials).toEqual([]);
        expect(live.calls).toEqual([]);
        const ledger = await rig.store.query<Ledger>(VISITOR, { collection: paths.collection(VISITOR, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
        expect(ledger.filter((d) => d.data.kind === "phoneCall")).toEqual([]);
      }),
      RUNS,
    );
  }, 600_000);
});
