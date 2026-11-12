// Transitions of `visitGone` (brief 044, item 2): the server answered STALE to an open, so the visit it named is
// gone. Titles read `<FROM> + <event> -> <TO> (<why>)`.
import { describe, expect, it } from "vitest";
import { OPEN_LIMIT_MS, type VoiceCommand } from "./machine";
import { WideDriver } from "./testing/arb-call-wide";

const V1 = `v${"1".padStart(42, "0")}`;
const V2 = `v${"2".padStart(42, "0")}`;
const kinds = (cmds: VoiceCommand[]) => cmds.map((c) => c.kind);
const opens = (d: WideDriver) => d.trace.steps.flatMap((s) => s.commands).filter((c): c is Extract<VoiceCommand, { kind: "open" }> => c.kind === "open");

function connecting(): WideDriver {
  const d = new WideDriver();
  d.ev({ type: "visitSet", visitId: V1 });
  d.start();
  return d;
}

describe("visit transitions (brief 044, item 2)", () => {
  it("CONNECTING + visitGone -> CLOSED (the tab's visit: no retry, error visit, nothing armed)", () => {
    const d = connecting();
    const cmds = d.ev({ type: "visitGone", visitId: V1 }, 200);
    expect(d.st).toMatchObject({ phase: "CLOSED", error: "visit", awaitingOpen: false, goneVisitId: V1, visitId: V1 });
    expect(d.st.deadlines).toEqual({});
    expect(kinds(cmds)).not.toContain("open");
    expect(kinds(cmds)).not.toContain("armTimer");
  });

  it("CLOSED + callPressed -> CLOSED (a gone visit opens nothing)", () => {
    const d = connecting();
    d.ev({ type: "visitGone", visitId: V1 });
    const cmds = d.ev({ type: "callPressed", zone: "UTC" }, 1_000);
    expect(d.st).toMatchObject({ phase: "CLOSED", error: "visit" });
    expect(cmds).toEqual([]);
    expect(opens(d)).toHaveLength(1);
  });

  it("CLOSED + visitSet, then callPressed -> CONNECTING (a new visit opens, naming it)", () => {
    const d = connecting();
    d.ev({ type: "visitGone", visitId: V1 });
    d.ev({ type: "visitSet", visitId: V2 });
    d.ev({ type: "callPressed", zone: "UTC" }, 1_000);
    expect(d.st.phase).toBe("CONNECTING");
    expect(opens(d).map((o) => o.body.visitId)).toEqual([V1, V2]);
    expect(d.st.deadlines.openWait).toBe(d.now + OPEN_LIMIT_MS);
  });

  it("CONNECTING + visitGone -> CLOSED (an older visit's answer is a failed open; the tab's visit stays usable)", () => {
    const d = connecting();
    d.ev({ type: "visitSet", visitId: V2 });
    d.ev({ type: "visitGone", visitId: V1 }, 200);
    expect(d.st).toMatchObject({ phase: "CLOSED", error: "open", awaitingOpen: false });
    expect(d.st.goneVisitId ?? null).toBeNull();
    d.ev({ type: "callPressed", zone: "UTC" }, 1_000);
    expect(opens(d).at(-1)!.body.visitId).toBe(V2);
  });

  it("RECOVERY + visitGone -> CLOSED (a reconnect's open answered STALE ends the call, with no further reconnect)", () => {
    const d = connecting();
    d.play({ action: { k: "openOk" }, dt: 100 });
    d.play({ action: { k: "channelOpen" }, dt: 100 });
    d.play({ action: { k: "stateOk", variant: "fresh" }, dt: 50 });
    d.play({ action: { k: "connectionLost" }, dt: 100 });
    expect(d.st.phase).toBe("RECOVERY");
    d.play({ action: { k: "fire", name: "reconnect" }, dt: 0 });
    expect(d.st.awaitingOpen).toBe(true);
    d.ev({ type: "visitGone", visitId: V1 }, 100);
    expect(d.st).toMatchObject({ phase: "CLOSED", error: "visit", recovery: null, retryVisible: false });
    expect(d.st.deadlines).toEqual({});
  });

  it("CLOSED + visitGone -> CLOSED (a late answer after a hang-up only remembers the visit)", () => {
    const d = connecting();
    d.ev({ type: "hangupPressed" });
    const cmds = d.ev({ type: "visitGone", visitId: V1 }, 200);
    expect(cmds).toEqual([]);
    expect(d.st).toMatchObject({ phase: "CLOSED", error: null, goneVisitId: V1 });
  });
});
