// The acting mapper's table and the one-shot edge machine (brief 013, design note §2.2 and §3.3).
import { describe, expect, it } from "vitest";
import { actingFor, INITIAL_EDGE, NO_COMMAND, oneShotStep } from "./acting";
import type { Acting, EdgeState, OneShot, OneShotCommand, Overlay, Pose } from "./acting";
import { LOOK_NAMES, lookFor } from "./look";
import type { AvatarInput, AvatarLook, LookName } from "./types";

const base: AvatarInput = {
  state: "listening",
  micMuted: false,
  outputMuted: false,
  inputLevel: 0,
  outputLevel: 0,
  event: null,
  eventElapsedMs: 0,
  firstConnecting: false,
  reducedMotion: false,
};
const input = (patch: Partial<AvatarInput>): AvatarInput => ({ ...base, ...patch });

type Follows = AvatarLook["follows"];
const FOLLOWS: readonly Follows[] = ["none", "input", "output"];

/** The §2.2 table, written out. `null` pose: from follows (input listening, output speaking, none thinking). */
const TABLE: Record<LookName, { pose: Pose | null; overlay: Overlay; oneShot: OneShot | null }> = {
  Dormant: { pose: "idle", overlay: "dormant", oneShot: null },
  Waking: { pose: "idle", overlay: "none", oneShot: "wake" },
  Connecting: { pose: "thinking", overlay: "none", oneShot: null },
  Listening: { pose: "listening", overlay: "none", oneShot: null },
  Thinking: { pose: "thinking", overlay: "none", oneShot: null },
  Speaking: { pose: "speaking", overlay: "none", oneShot: null },
  Recovery: { pose: "idle", overlay: "recovery", oneShot: null },
  Presenting: { pose: null, overlay: "none", oneShot: null },
  Awaiting_Approval: { pose: null, overlay: "awaiting", oneShot: null },
  Celebrate: { pose: null, overlay: "none", oneShot: "celebrate" },
};
const FROM_FOLLOWS: Record<Follows, Pose> = { input: "listening", output: "speaking", none: "thinking" };

/** A look with the given name, ghost, follows and electric; the other fields are the Listening row's. */
function look(name: LookName, ghost: boolean, follows: Follows, electric: boolean): AvatarLook {
  return { ...lookFor(input({ micMuted: ghost })), name, ghost, follows, drive: 0, electric };
}

describe("actingFor: the §2.2 table, row by row", () => {
  for (const name of LOOK_NAMES) {
    for (const ghost of [false, true]) {
      for (const follows of FOLLOWS) {
        for (const electric of [false, true]) {
          it(`${name}, ghost ${ghost}, follows ${follows}, electric ${electric}`, () => {
            const row = TABLE[name];
            const expected: Acting = {
              name,
              pose: row.pose ?? FROM_FOLLOWS[follows],
              overlay: row.overlay,
              oneShot: row.oneShot,
              ghost,
              mic: follows === "input",
              voice: follows === "output",
              electric,
              followPointer: false,
            };
            expect(actingFor(look(name, ghost, follows, electric))).toEqual(expected);
          });
        }
      }
    }
  }
});

describe("actingFor over the Look_Mapper", () => {
  it("Dormant: idle under the dormant overlay, both gates shut", () => {
    expect(actingFor(lookFor(input({ state: "closed" })))).toEqual({
      name: "Dormant", pose: "idle", overlay: "dormant", oneShot: null, ghost: false, mic: false, voice: false, electric: false, followPointer: false,
    });
  });

  it("Waking: the wake one-shot over idle, electric", () => {
    expect(actingFor(lookFor(input({ state: "connecting", firstConnecting: true, event: "wake" })))).toEqual({
      name: "Waking", pose: "idle", overlay: "none", oneShot: "wake", ghost: false, mic: false, voice: false, electric: true, followPointer: false,
    });
  });

  it("Connecting acts thinking, as the prototype maps a connecting call", () => {
    const a = actingFor(lookFor(input({ state: "connecting" })));
    expect(a).toMatchObject({ name: "Connecting", pose: "thinking", overlay: "none", oneShot: null, electric: true });
  });

  it("Listening opens the mic gate only", () => {
    expect(actingFor(lookFor(input({ state: "listening", inputLevel: 0.5 })))).toMatchObject({ pose: "listening", mic: true, voice: false });
  });

  it("Speaking opens the voice gate only", () => {
    expect(actingFor(lookFor(input({ state: "speaking", outputLevel: 0.5 })))).toMatchObject({ pose: "speaking", mic: false, voice: true });
  });

  it("speaking with output muted acts Thinking with both gates shut", () => {
    expect(actingFor(lookFor(input({ state: "speaking", outputMuted: true, outputLevel: 0.9 })))).toMatchObject({
      name: "Thinking", pose: "thinking", mic: false, voice: false, electric: true,
    });
  });

  it("Recovery: idle under the recovery overlay", () => {
    expect(actingFor(lookFor(input({ state: "recovery" })))).toMatchObject({ pose: "idle", overlay: "recovery", oneShot: null, mic: false, voice: false });
  });

  it("Presenting and Awaiting_Approval have electric false over a thinking state", () => {
    const presenting = actingFor(lookFor(input({ state: "thinking", event: "present-card" })));
    expect(presenting).toMatchObject({ name: "Presenting", pose: "thinking", overlay: "none", electric: false });
    const awaiting = actingFor(lookFor(input({ state: "thinking", event: "await-approval" })));
    expect(awaiting).toMatchObject({ name: "Awaiting_Approval", pose: "thinking", overlay: "awaiting", electric: false });
  });

  it("event looks take their pose from the underlying state", () => {
    expect(actingFor(lookFor(input({ state: "listening", event: "celebrate" })))).toMatchObject({ pose: "listening", oneShot: "celebrate", mic: true });
    expect(actingFor(lookFor(input({ state: "speaking", event: "celebrate" })))).toMatchObject({ pose: "speaking", voice: true });
    expect(actingFor(lookFor(input({ state: "speaking", outputMuted: true, event: "await-approval" })))).toMatchObject({ pose: "thinking", voice: false });
  });

  it("the ghost overlay never changes the pose, the overlay or the gates", () => {
    for (const patch of [{ state: "listening" as const }, { state: "speaking" as const }, { state: "closed" as const }]) {
      const plain = actingFor(lookFor(input(patch)));
      const ghost = actingFor(lookFor(input({ ...patch, micMuted: true })));
      expect(ghost).toEqual({ ...plain, ghost: true });
    }
  });
});

describe("oneShotStep", () => {
  type Row = [prev: OneShot | null, skipped: boolean, next: OneShot | null, running: boolean, state: EdgeState, command: OneShotCommand];
  const none: OneShotCommand = { wake: "none", celebrate: "none" };
  const cut: OneShotCommand = { wake: "none", celebrate: "cut" };
  const startWake: OneShotCommand = { wake: "start", celebrate: "none" };
  const startCeleb: OneShotCommand = { wake: "none", celebrate: "start" };
  const cutWake: OneShotCommand = { wake: "cut", celebrate: "none" };
  const e =(oneShot: OneShot | null, skipped: boolean): EdgeState => ({ oneShot, skipped });

  // Every (previous, next, running), for both values of the previous skipped flag.
  const ROWS: Row[] = [];
  for (const skipped of [false, true]) {
    ROWS.push(
      [null, skipped, null, false, e(null, false), none],
      [null, skipped, null, true, e(null, false), none],
      [null, skipped, "wake", false, e("wake", true), none],
      [null, skipped, "wake", true, e("wake", false), startWake],
      [null, skipped, "celebrate", false, e("celebrate", true), none],
      [null, skipped, "celebrate", true, e("celebrate", false), startCeleb],
      // Leaving a wake that started cuts it; a skipped wake never played, so it needs no cut.
      ["wake", skipped, null, false, e(null, false), skipped ? none : cutWake],
      ["wake", skipped, null, true, e(null, false), skipped ? none : cutWake],
      ["wake", skipped, "wake", false, e("wake", skipped), none],
      ["wake", skipped, "wake", true, e("wake", skipped), none],
      ["wake", skipped, "celebrate", false, e("celebrate", true), skipped ? none : cutWake],
      ["wake", skipped, "celebrate", true, e("celebrate", false), skipped ? startCeleb : { wake: "cut", celebrate: "start" }],
      ["celebrate", skipped, null, false, e(null, false), cut],
      ["celebrate", skipped, null, true, e(null, false), cut],
      ["celebrate", skipped, "wake", false, e("wake", true), cut],
      ["celebrate", skipped, "wake", true, e("wake", false), { wake: "start", celebrate: "cut" }],
      ["celebrate", skipped, "celebrate", false, e("celebrate", skipped), none],
      ["celebrate", skipped, "celebrate", true, e("celebrate", skipped), none],
    );
  }

  for (const [prev, skipped, next, running, state, command] of ROWS) {
    it(`${prev ?? "none"} (skipped ${skipped}) to ${next ?? "none"}, running ${running}`, () => {
      expect(oneShotStep(e(prev, skipped), next, running)).toEqual({ state, command });
    });
  }

  it("starts from no one-shot, not skipped", () => {
    expect(INITIAL_EDGE).toEqual({ oneShot: null, skipped: false });
    expect(NO_COMMAND).toEqual({ wake: "none", celebrate: "none" });
  });

  it("does not mutate its input or the shared constants", () => {
    const s = { ...INITIAL_EDGE };
    const out = oneShotStep(s, "celebrate", true);
    out.command.celebrate = "cut";
    expect(s).toEqual(INITIAL_EDGE);
    expect(NO_COMMAND).toEqual({ wake: "none", celebrate: "none" });
    expect(oneShotStep(INITIAL_EDGE, null, true).command).toEqual(NO_COMMAND);
  });

  it("a wake skipped during the build keeps waiting until the look leaves it, then clears", () => {
    let s: EdgeState = INITIAL_EDGE;
    s = oneShotStep(s, "wake", false).state;
    expect(s).toEqual({ oneShot: "wake", skipped: true });
    s = oneShotStep(s, "wake", true).state;
    expect(s).toEqual({ oneShot: "wake", skipped: true });
    const left = oneShotStep(s, null, true);
    expect(left).toEqual({ state: { oneShot: null, skipped: false }, command: NO_COMMAND });
  });

  it("a wake that started and is left early (a first call that fails at once) is cut", () => {
    let s: EdgeState = INITIAL_EDGE;
    const entered = oneShotStep(s, "wake", true);
    expect(entered.command).toEqual({ wake: "start", celebrate: "none" });
    s = entered.state;
    expect(oneShotStep(s, null, true).command).toEqual({ wake: "cut", celebrate: "none" });
    expect(oneShotStep(s, null, false).command).toEqual({ wake: "cut", celebrate: "none" });
  });
});

describe("actingFor: attend (brief 015)", () => {
  it("Listening with attend pointer follows the pointer; nothing else changes", () => {
    const look = lookFor(input({ state: "listening" }));
    const plain = actingFor(look);
    expect(plain.followPointer).toBe(false);
    expect(actingFor(look, "pointer")).toEqual({ ...plain, followPointer: true });
  });

  it("attend camera, or absent, never follows", () => {
    for (const state of ["closed", "connecting", "listening", "thinking", "speaking", "recovery"] as const) {
      const look = lookFor(input({ state }));
      expect(actingFor(look, "camera")).toEqual(actingFor(look));
      expect(actingFor(look).followPointer).toBe(false);
    }
  });

  it("only the Listening look follows: every other state and every event look stays on its own gaze", () => {
    for (const state of ["closed", "connecting", "thinking", "speaking", "recovery"] as const) {
      expect(actingFor(lookFor(input({ state })), "pointer").followPointer).toBe(false);
    }
    for (const event of ["wake", "present-card", "await-approval", "celebrate"] as const) {
      const a = actingFor(lookFor(input({ state: "listening", event })), "pointer");
      expect(a.name).not.toBe("Listening");
      expect(a.followPointer).toBe(false);
    }
  });

  it("the ghost overlay over Listening still follows, and still reads as ghost", () => {
    const a = actingFor(lookFor(input({ state: "listening", micMuted: true })), "pointer");
    expect(a).toMatchObject({ name: "Listening", ghost: true, followPointer: true });
  });
});
