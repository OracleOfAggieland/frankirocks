import { describe, expect, it } from "vitest";
import { type AnnounceView, announcement, callStatus } from "./announce";

const view = (patch: Partial<AnnounceView> = {}): AnnounceView => ({ avatar: "Franki is asleep", call: "Call idle", error: null, ...patch });

describe("announcement", () => {
  it("announces nothing on the first render", () => {
    expect(announcement(null, view())).toBeNull();
  });

  it("announces one change", () => {
    expect(announcement(view(), view({ avatar: "Franki is listening" }))).toBe("Franki is listening.");
  });

  it("joins three changes in order", () => {
    const next = view({ avatar: "Franki is having trouble connecting", call: "Reconnecting", error: "The call did not start." });
    expect(announcement(view(), next)).toBe("Franki is having trouble connecting. Reconnecting. The call did not start.");
  });

  it("does not announce a cleared error or an unchanged view", () => {
    expect(announcement(view({ error: "Oops." }), view())).toBeNull();
    expect(announcement(view(), view())).toBeNull();
  });
});

describe("callStatus", () => {
  it("names each phase group", () => {
    expect(callStatus({ phase: "CLOSED", hangingUp: false })).toBe("Call idle");
    expect(callStatus({ phase: "CONNECTING", hangingUp: false })).toBe("Connecting");
    expect(callStatus({ phase: "CONFIGURING", hangingUp: false })).toBe("Connecting");
    expect(callStatus({ phase: "LISTENING", hangingUp: false })).toBe("Call connected");
    expect(callStatus({ phase: "SPEAKING", hangingUp: false })).toBe("Call connected");
    expect(callStatus({ phase: "RECOVERY", hangingUp: false })).toBe("Reconnecting");
    expect(callStatus({ phase: "LISTENING", hangingUp: true })).toBe("Hanging up");
  });
});
