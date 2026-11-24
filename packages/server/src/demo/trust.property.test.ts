/**
 * Trust (brief 054 design, correctness property 7; R13.3, R13.5, R13.6, R22.2). 1,000 runs.
 *   FOR ALL mail lines L of a demo fixture (the test fixture and the Kisses persona), zones and visit times:
 *   on a cloned demo visit, the sender the real mail agent (`search_mail` over the simulated Gmail) registers for L is
 *   mailed exactly when L is the owner's own, or L's DMARC is a pass (or omitted), L is not bulk, and some own line of
 *   the fixture was sent to L's address (the fixture carries no "mailed" field: the rule decides);
 *   AND its display name is kept exactly when it is mailed or Gmail authenticated it;
 *   AND for a line citing L alone, the Gate (`gateErrandLines`) says it only when the run's taint
 *   (`taintErrandLines`) let it be spoken, and the taint lets it be spoken exactly when L is the owner's own or its
 *   sender can be named by code.
 */
import { type CoreEpoch, type Errand, msFromTs, type ErrandRead, type ID, SAFE_NAME_FALLBACK, UNKNOWN_ADDRESS_LABEL, errandAddressLabel, safeName, taintErrandLines } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ErrandToolContext } from "../errands/agent";
import { gateErrandLines } from "../errands/gate";
import { mailAgent } from "../errands/google-agents";
import { registeredRead } from "../errands/run";
import type { MailLine, SeedFixture } from "../seed/fixture";
import { paths } from "../store/paths";
import { DEMO_FIXTURES, VISITOR, demoRig, resetDemo } from "../testing/demo-fixture";
import { SEED_ZONES } from "../testing/seed";
import { layoutOf } from "./layout";

const RUNS = { numRuns: 1000 };
const mailLines = (f: SeedFixture) => f.lines.filter((l): l is MailLine => l.kind === "mail");
const lower = (s: string) => s.trim().toLowerCase();

/** The rule, from the fixture's own lines. */
function expectedMailed(f: SeedFixture, l: MailLine): boolean {
  if (l.fromSelf) return true;
  if (l.dmarc === "fail" || l.dmarc === "none" || l.bulk) return false;
  return mailLines(f).some((o) => o.fromSelf && o.to.some((a) => lower(a) === lower(l.from.address)));
}
const authenticated = (l: MailLine) => !l.fromSelf && l.dmarc !== "fail" && l.dmarc !== "none";

const cases = fc.constantFrom(...DEMO_FIXTURES.flatMap((f) => mailLines(f).map((l) => ({ f, l }))));

/** A tool context the way the runner builds one, over the route context the errand run endpoint builds (no token). */
function toolCtx(rig: ReturnType<typeof demoRig>["rig"], epoch: number) {
  const reads: ErrandRead[] = [];
  const ctx: ErrandToolContext = {
    route: { uid: VISITOR, deps: rig.deps, schedule: rig.sched.schedule },
    errandId: "e".repeat(43) as ID,
    ownerWords: ["Check my mail."],
    signal: new AbortController().signal,
    read: (r) => {
      const same = reads.find((x) => x.evidenceId === r.evidenceId && x.rev === r.rev);
      if (same !== undefined) return same.ref;
      const v = registeredRead(`r${reads.length + 1}`, r);
      if (v === null) return null;
      reads.push(v);
      return v.ref;
    },
    epoch,
    scratch: new Map(),
    readsLeft: () => 32 - reads.length,
    flag: () => {},
  };
  return { ctx, reads };
}

describe("mail trust on a demo visit comes from the fixture through the real rule", () => {
  it("registers each sender as the rule says, and the Gate follows the taint", async () => {
    if (DEMO_FIXTURES.every((f) => mailLines(f).length === 0)) return;
    await fc.assert(
      fc.asyncProperty(cases, fc.constantFrom(...SEED_ZONES), fc.integer({ min: 0, max: 30 * 86_400_000 }), async ({ f, l }, zone, laterMs) => {
        const { rig, live } = demoRig();
        rig.clock.advance(laterMs);
        const reset = await resetDemo(rig, f.id, 1, zone);
        expect(reset.status).toBe(200);
        const worldStart = msFromTs(reset.body.worldClock);
        const epoch = (await rig.store.get<CoreEpoch>(VISITOR, paths.core(VISITOR, "epoch")))!.data.epoch;
        const { ctx, reads } = toolCtx(rig, epoch);
        const search = mailAgent.tools.find((t) => t.name === "search_mail")!;
        const words = l.subject.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3).slice(0, 3);
        const out = (await search.run(ctx, { from: l.from.address, words, when: null, unread: false })) as { messages?: unknown[]; error?: string };
        expect(out.error).toBeUndefined();

        // The read of L: same address, subject and instant as the simulator dates it.
        const at = new Date(layoutOf({ kind: "access", fixtureId: f.id, worldStart, zone }, new Map([[f.id, f]]))!.at(l.at)).toISOString();
        const mine = reads.filter((r) => r.source.kind === "mail" && r.sender !== null && lower(r.sender.address) === lower(l.from.address) && r.source.subject === l.subject.slice(0, 120).trim() && r.source.at === at);
        const twins = mailLines(f).filter((o) => lower(o.from.address) === lower(l.from.address) && o.subject === l.subject && JSON.stringify(o.at) === JSON.stringify(l.at));
        fc.pre(twins.every((o) => expectedMailed(f, o) === expectedMailed(f, l) && authenticated(o) === authenticated(l)));
        expect(mine.length).toBeGreaterThan(0);

        const mailed = expectedMailed(f, l);
        for (const r of mine) {
          expect(r.sender!.mailed).toBe(mailed);
          expect(r.sender!.name !== "").toBe(mailed || authenticated(l));
          expect(r.cls).toBe(l.fromSelf ? "O" : "T");

          // A line citing this read alone, through the run's taint and then the Gate, in private with a sure speaker.
          const nowMs = rig.clock.read().worldClock.now;
          const [line] = taintErrandLines([{ text: "There is a message about it.", refs: [r.ref], cls: r.cls, sens: r.sens, attribution: null }], [r], [], { nowMs, zone });
          expect(line).toBeDefined();
          const name = safeName(r.sender!.name);
          const nameable = name !== SAFE_NAME_FALLBACK || errandAddressLabel(r.sender!.address) !== UNKNOWN_ADDRESS_LABEL;
          expect(line!.speak).toBe(l.fromSelf || nameable);
          const errand = { lines: [line!] } as unknown as Errand;
          const [v] = gateErrandLines({ errand, inputs: { certain: true, aliases: ["mail"] }, audience: "private", modifiers: { rushed: false, crisis: false }, worldNow: nowMs, zone, candidateId: (i) => `c${i}`.padEnd(43, "0") as ID });
          if (!line!.speak) expect(v!.shown).not.toBe("say");
          if (v!.shown === "say" && !l.fromSelf) expect(line!.attribution).toContain(mailed || authenticated(l) ? name : errandAddressLabel(r.sender!.address));
        }
        expect(live.calls).toEqual([]);
      }),
      RUNS,
    );
  }, 600_000);
});
