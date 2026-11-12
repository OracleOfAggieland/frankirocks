// Brief 043, new property 5: what the route did not do, extraction still can. The owner has one role at Acme. A job
// change is said; Fake_FastSlots answers with an item that writes nothing (a new employer as counterpart, a date
// after now, `need`), or invalid, or a transport failure; a call is open or not. Whenever the route's entries for the
// turn wrote nothing, the same turn's extraction, naming the Acme role as its target, ends it.
import { type CoreRules, type FastItem, type ID, type Session, mentionEid } from "@franki/core";
import { testId } from "@franki/core/testing";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ok } from "../openai/fake";
import { completed } from "../openai/responses";
import { paths } from "../store/paths";
import { changedIds, memoriesOf } from "../testing/arb-corrections";
import { decisionAnswer } from "../testing/decisions";
import { extractOutput, factItem } from "../testing/extract-fixtures";
import type { FakeSlotsAnswer } from "../testing/fake-fast-slots";
import { callRoute, patchRecord, settle, testRig } from "../testing/fakes";
import { UID, at, byMention, seed, transition } from "../testing/review-043";
import { openTestSession, typedTurn } from "../testing/session-fixtures";
import { turnEvidenceId } from "../turns";
import { runExtractJob } from "../worker/extract";
import { extractJobId } from "../worker/extract-jobs";
import { turnRoute } from "./turn";

const TEXTS = ["I left my job yesterday and I start at Brill on Monday.", "I quit my job yesterday, I start at Brill next week.", "I left my job and start at Brill on Friday."] as const;
type Variant = "brill" | "friday" | "need" | "invalid" | "transport" | "none";

describe("Property 5 (brief 043): what the route did not do, extraction still can", () => {
  it("a route entry that wrote nothing leaves the role to extraction", { timeout: 600_000 }, async () => {
    let checked = 0;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...TEXTS), fc.constantFrom<Variant>("brill", "brill", "friday", "need", "invalid", "transport", "none"), fc.boolean(), async (text, variant, call) => {
        const rig = testRig();
        const H = rig.deps.hasher;
        const [role] = await seed(rig, "I work at Acme as an engineer.", [
          { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "engineer" }, args: { employerRef: mentionEid("organization", "acme", H), managerRef: null }, line: "The owner's job is engineer at Acme." },
        ]);
        const s = await openTestSession(rig);
        await patchRecord<Session>(rig.store, UID, paths.session(UID, s.sessionId), call ? { status: "active", registeredCallIds: ["rtc_a"], callId: "rtc_a" } : { status: "active" });
        rig.openai.always("decisions.create", ok(decisionAnswer({ transition: 0.9 })));
        rig.openai.always("responses.create", ok(completed("Good luck.")));
        const item = (eid: string): FastItem =>
          transition(text, (e) => ({ transition: "jobChangeOwn", counterpart: variant === "friday" ? null : byMention(at(e, text, "Brill")), whenSpoken: variant === "friday" ? "Friday" : "yesterday" }))(eid);
        rig.fastSlots.script((input): FakeSlotsAnswer => {
          if (variant === "invalid") return { kind: "invalid", reason: "shape", path: "$.items", ms: 50 };
          if (variant === "transport") return { kind: "transport", ms: 5 };
          return { kind: "valid", out: { items: variant === "none" ? [] : [item(input.turn.eid)], need: variant === "need" ? "time" : "none" }, ms: 50 };
        });
        const before = await memoriesOf(rig.store);
        const res = await callRoute(rig, turnRoute, typedTurn(s.stamp, 1, text));
        expect(res.status).toBe(200);
        const rules = (await rig.store.get<CoreRules>(UID, paths.core(UID, "rules")))!.data;
        const entries = rules.handled.flatMap((h) => h.entries);
        // Only turns on which the route wrote nothing at all.
        if (changedIds(before, await memoriesOf(rig.store)).length > 0) return;
        checked++;
        const eid = turnEvidenceId(testId("turn-1") as ID, H);
        const span = (w: string) => ({ eid, fieldPath: "text" as const, start: text.indexOf(w), end: text.indexOf(w) + w.length, quote: w });
        const out = {
          ...factItem("transition", "new", "engineer", [span(text.slice(0, text.indexOf("job") + 3))]),
          predicate: "employment.role",
          args: { employerRef: "m1", managerRef: null },
          mentions: [{ localId: "m1", type: "organization", observedName: "Brill", span: span("Brill"), existingId: null }],
          changes: [{ verb: "transition", targetMid: role }],
        };
        rig.openai.script("responses.create", ok(completed(JSON.stringify(extractOutput([out])))));
        await settle(runExtractJob(UID, extractJobId(eid, H), rig.deps), rig.clock, rig.timers);
        expect((await memoriesOf(rig.store)).get(role!)!.status, `"${text}" ${variant} call ${call}: entries ${JSON.stringify(entries)}`).toBe("history");
      }),
      { numRuns: 1000 },
    );
    expect(checked).toBeGreaterThan(100);
  });
});
