/**
 * The count per release gate (brief 034 part 5; spec §13). It counts what is written, not what passes: each script's
 * own suite says whether its steps are green. A script is "waiting" when any of its steps waits, and a wait is grouped
 * by what it waits for (`W` in gate-kit.ts; a wait of its own is "other").
 *
 * The numbers are pinned, so a script added, removed, or a wait dropped after a fix shows here as a change to make on
 * purpose.
 */
import { describe, expect, it } from "vitest";
import { EXPOSURE } from "./gate-exposure";
import { FOOD } from "./gate-food";
import { FRIEND, FRIEND_POINTERS } from "./gate-friend";
import { type GateScript, waitKey } from "./gate-kit";
import { POISON, POISON_029 } from "./gate-poison";

const waitsOf = (s: GateScript) => s.steps.flatMap((st) => (st.waits === undefined ? [] : [st.waits]));

function summary(scripts: readonly GateScript[]) {
  const byWait: Record<string, number> = {};
  for (const s of scripts) for (const k of new Set(waitsOf(s).map(waitKey))) byWait[k] = (byWait[k] ?? 0) + 1;
  const waiting = scripts.filter((s) => waitsOf(s).length > 0).length;
  return {
    written: scripts.length,
    green: scripts.length - waiting,
    waiting,
    waitingSteps: scripts.reduce((n, s) => n + waitsOf(s).length, 0),
    silent: scripts.filter((s) => s.silentGreen !== undefined).length,
    byWait,
  };
}

describe("release gates: the count per gate (spec §13)", () => {
  it("every script has a unique id", () => {
    const ids = [...FOOD, ...POISON, ...EXPOSURE, ...FRIEND].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hard-rule miss: 40 food moments", () => {
    expect(FOOD.length).toBeGreaterThanOrEqual(40);
    expect(summary(FOOD)).toEqual({
      written: 40,
      green: 40,
      waiting: 0,
      waitingSteps: 0,
      silent: 0,
      byWait: {},
    });
  });

  it("poisoning: 15 (five in brief 029's poison.test.ts, ten here)", () => {
    expect(POISON_029.length + POISON.length).toBe(15);
    expect(summary(POISON)).toEqual({ written: 10, green: 10, waiting: 0, waitingSteps: 0, silent: 10, byWait: {} });
  });

  it("S1+ on a company or quiet line, judge forced to O: 6+ company, 6+ quiet, 12 in all", () => {
    const company = EXPOSURE.filter((s) => s.meta.kind === "company");
    const quiet = EXPOSURE.filter((s) => s.meta.kind === "quiet");
    expect(company.length).toBeGreaterThanOrEqual(6);
    expect(quiet.length).toBeGreaterThanOrEqual(6);
    expect(EXPOSURE.length).toBeGreaterThanOrEqual(12);
    // Brief 035 (findings 11 and 9): the blocked answer carries no Deck, so the Deck step is green in all twelve.
    expect(summary(EXPOSURE)).toEqual({ written: 12, green: 12, waiting: 0, waitingSteps: 0, silent: 12, byWait: {} });
  });

  it("Friend Tests: every test counted at 200 h has a script or a pointer, and none of the Later ones", () => {
    const later = [5, 7, 19, 26, 27];
    const scripted = FRIEND.map((s) => Number(s.meta.test));
    const pointed = FRIEND_POINTERS.map((p) => p.test);
    for (const t of later) expect([...scripted, ...pointed]).not.toContain(t);
    const covered = new Set([...scripted, ...pointed]);
    const counted = Array.from({ length: 28 }, (_, i) => i + 1).filter((t) => !later.includes(t));
    expect(counted.filter((t) => !covered.has(t))).toEqual([]);
    expect(summary(FRIEND)).toEqual({
      written: 20,
      green: 9,
      waiting: 11,
      waitingSteps: 12,
      silent: 1,
      byWait: { other: 8, GATE_WIRE: 2, MAIL_READ: 1 },
    });
  });
});
