// Feature: review of the hero and food (brief 037), Property 1: no allergen on the list, on the server path.
// For any stored rules on any subjects (active, pending, proposed, unresolved), and any interleaving of a rule write
// with the yes (a rule or a proposal landing after the handler's reads and before anything is written): no dinner,
// no list line and no card line holds an ingredient that conflicts with any stored rule, and a list is written only
// inside an admitted turn. The ingredient oracle is the hand-written table of what foods commonly hold
// (core food/testing/prepared-foods-oracle.ts), independent of the product's ingredient table; the allergen
// families are the independent copy in food/testing/allergen-oracle.ts.
import { type CoreRules, type CoreState, type Ledger, buildSlice } from "@franki/core";
import { HERO_BASELINE_GROCERIES, HERO_COVERAGE, HERO_MEETINGS, HERO_ORDERS, HERO_ZONE, PREPARED_FOODS_ORACLE, instantAt, oracleConflicts, oracleKnown, sampleEvidence, testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ensureCoreDocs } from "../core-docs";
import { paths } from "../store/paths";
import { callRoute, testRig } from "../testing/fakes";
import { asrTurn, openTestSession } from "../testing/session-fixtures";
import { recordPendingRendered } from "../time/reminder";
import { toolRoute } from "./tool";
import { heroOffer } from "./tool-food";
import { turnRoute } from "./turn";

const UID = "owner-1";
type Rule = CoreRules["allergies"][number];
const SUBJECTS = ["self", testId("partner"), testId("sister"), null] as const;
const CODES = ["egg", "milk", "wheat", "gluten", "soy", "sesame", "shellfish", "shrimp", "fish", "anchovy", "tree_nut", "cashew", "walnut", "almond", "pine_nut", "peanut", "nuts", "chicken", "red_meat", "sulphite", "food_dye", "garlic", "citrus", "corn", "alcohol", "unresolved"];
const BY_LABEL = new Map(PREPARED_FOODS_ORACLE.map((o) => [o.label, o]));

let serial = 0;
const ruleArb: fc.Arbitrary<Rule> = fc.record({ subject: fc.constantFrom(...SUBJECTS), code: fc.constantFrom(...CODES), state: fc.constantFrom<"active" | "pending">("active", "pending") }).map(({ subject, code, state }) => ({
  id: testId(`p1r${serial++}`),
  subjectId: subject,
  code,
  state,
  anonymous: subject === null,
  proof: null,
  proofRev: null,
  rootKeys: [],
  dependsOn: [],
}));

const caseArb = fc.record({
  stored: fc.array(ruleArb, { maxLength: 3 }),
  proposed: fc.array(ruleArb, { maxLength: 2 }),
  between: fc.oneof(fc.constant(null), fc.record({ how: fc.constantFrom<"rule" | "proposal">("rule", "proposal"), rule: ruleArb })),
  tool: fc.constantFrom<"answer" | "suggest">("answer", "answer", "suggest"),
});

/** True when the oracle says a food with this label may hold something a rule keeps away. Unknown labels conflict. */
function conflicts(label: string, rules: readonly Rule[]): boolean {
  const food = BY_LABEL.get(label);
  if (food === undefined) return true;
  return rules.some((r) => !oracleKnown(r.code) || food.commonly.some((c) => oracleConflicts(r.code, c)));
}

const cardLabels = (lines: readonly string[]) => lines.flatMap((l) => (l.split(": ")[1] ?? "").split(", ").filter((x) => x !== ""));

async function world() {
  const rig = testRig();
  rig.clock.setWorld(instantAt("2026-10-26", 12 * 60, HERO_ZONE));
  await ensureCoreDocs(UID, rig.deps);
  await rig.store.transaction(UID, async (tx) => {
    const state = await tx.get<CoreState>(paths.core(UID, "state"));
    tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE, coverage: HERO_COVERAGE });
    for (const r of [...HERO_ORDERS, ...HERO_BASELINE_GROCERIES, ...HERO_MEETINGS] as { id: string; rootKey: string; bank?: unknown; calendar?: unknown }[]) {
      const kind = r.bank !== undefined ? "transaction" : "calendar";
      const text = `${kind} ${r.id}`;
      const slice = buildSlice({ eid: r.id, fieldPath: "text", fieldText: text, start: 0, end: text.length, class: "O", sens: "S1" }, rig.deps.hasher);
      tx.create(paths.evidence(UID, r.id), sampleEvidence({ logicalId: r.id, kind, source: kind === "transaction" ? "plaid" : "calendar", observation: (r.bank ?? r.calendar) as never, rootKeys: [r.rootKey], text: { kind: "inline", text }, fieldSlices: [slice] }));
    }
  });
  return rig;
}

async function writeRules(rig: Awaited<ReturnType<typeof world>>, rules: Rule[], how: "rule" | "proposal") {
  await rig.store.transaction(UID, async (tx) => {
    const doc = (await tx.get<CoreRules>(paths.core(UID, "rules")))!;
    const r = doc.data;
    tx.update(
      paths.core(UID, "rules"),
      how === "rule" ? { ...r, allergies: [...r.allergies, ...rules], rulesRev: r.rulesRev + 1 } : { ...r, proposals: [...(r.proposals ?? []), { id: testId(`p1p${serial++}`), origin: "backstop", turnId: null, eid: testId("p1eid"), install: rules }] },
    );
  });
}

describe("Property 1: no allergen on the list, on the server path", () => {
  it("no dinner, list line or card line conflicts with a stored rule, and a list is written only when admitted", async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ stored, proposed, between, tool }) => {
        const rig = await world();
        if (stored.length > 0) await writeRules(rig, stored, "rule");
        const s = await openTestSession(rig);
        await rig.store.transaction(UID, async (tx) => {
          const state = await tx.get<CoreState>(paths.core(UID, "state"));
          tx.update(paths.core(UID, "state"), { ...state!.data, currentZone: HERO_ZONE });
        });
        const ctx = { uid: UID, deps: rig.deps, schedule: rig.sched.schedule };
        const offer = (await heroOffer(ctx, s.stamp.generation))!;
        await rig.store.transaction(UID, (tx) => recordPendingRendered(tx, UID, offer.pendingId as never, rig.deps.clock.read().opsClock.now, rig.deps.hasher));
        rig.clock.advance(10);
        const text = tool === "answer" ? "Yes, let's do it" : "What should I make for dinner";
        const t = await callRoute(rig, turnRoute, asrTurn(s.stamp, 1, text, [{ itemId: "item_1", commitSeq: 1 }]));
        if (t.status !== 200) throw new Error(JSON.stringify(t.body));
        // Proposals land after the turn, which would otherwise install them (G39).
        if (proposed.length > 0) await writeRules(rig, proposed, "proposal");
        const stamp = { ...s.stamp, turnId: testId("turn-1") };

        const real = rig.store.transaction.bind(rig.store);
        let calls = 0;
        if (between !== null) {
          rig.store.transaction = (async (uid: string, fn: never) => {
            calls += 1;
            if (calls === 2) {
              rig.store.transaction = real;
              await writeRules(rig, [between.rule], between.how);
            }
            return real(uid, fn);
          }) as typeof rig.store.transaction;
        }
        const args = tool === "answer" ? { pendingId: offer.pendingId, choiceId: offer.yesId } : { domain: "food", query: "quick dinner", attendeeIds: [], when: null, contextId: null };
        const res = await callRoute(rig, toolRoute, { requestId: testId("p1tool"), stamp, callId: "call_1", tool: { name: tool, args } });
        rig.store.transaction = real;

        const all = [...stored, ...proposed, ...(between === null ? [] : [between.rule])];
        const lines = ((res.body.result?.cards ?? []) as { kind: string; lines: string[] }[]).filter((c) => c.kind === "food").flatMap((c) => c.lines);
        for (const label of cardLabels(lines)) expect(conflicts(label, all), `card holds ${label}`).toBe(false);
        const actions = (await rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "action");
        for (const a of actions) {
          for (const item of (a.data.payload as { items: { label: string }[] }).items) expect(conflicts(item.label, all), `list holds ${item.label}`).toBe(false);
          expect(res.body.status, "a list without an admitted turn").toBe("ready");
          expect(res.body.permit).not.toBeNull();
          expect(res.body.result).toMatchObject({ name: "answer", state: "applied", receiptId: a.id });
        }
      }),
      { numRuns: 1000 },
    );
  }, 600_000);
});
