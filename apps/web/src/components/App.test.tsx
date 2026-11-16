// The App shell's wiring (lab-ui-foundation R4.6, R13.3, R14.1, R17.5, R18.5 to R18.8, R21), with a fake API
// and fake sources. Replaces the Stand_In_Avatar's recovery check: `data-look="Recovery"` on the avatar.
import { type VoiceState, initialVoiceState } from "@franki/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ApiResult } from "../client/api";
import { createBrowserClock } from "../client/clock";
import { TypedTurns } from "../client/typed-turns";
import type { PeerLike, StreamLike } from "../client/voice-client";
import { debugVisible } from "../ui/debug-flag";
import { EVENT_MS } from "../ui/motion";
import { ScreenController } from "../ui/hooks/screen-controller";
import { EMPTY_COPIES, createSignedInControllers, onForgetComplete } from "./app-controllers";
import { Avatar } from "./avatar/Avatar";
import { CALL_ERRORS } from "./CallScreen";
import { ReplyLine } from "./ReplyLine";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeApi() {
  const calls: string[] = [];
  const api: ApiClient = {
    async call<T>(path: string) {
      calls.push(path);
      return { ok: false, kind: "http", status: 503, error: "DEPENDENCY", retryAfterMs: 0 } as ApiResult<T>;
    },
  };
  return { api, calls };
}

const clock = () => createBrowserClock({ zone: "UTC", monotonic: { timeOrigin: 0, now: () => 0 } });
const controllers = (debug: boolean, api: ApiClient) =>
  createSignedInControllers({
    api,
    clock: clock(),
    transcribeModel: null,
    debug,
    audio: () => ({ muted: true, srcObject: null }),
    createPeer: () => ({}) as PeerLike,
    getMicrophone: async () => ({ getAudioTracks: () => [] }) as StreamLike,
    onStreams: () => {},
  });

describe("App while signed out", () => {
  it("sends no request to any /api/ route", async () => {
    const fetchSpy = vi.fn<(url: string) => Promise<Response>>(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchSpy);
    const { App } = await import("./App");
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('data-screen="signed-out"');
    expect(html).toContain('data-look="Dormant"');
    // A quiet way back to the front door (brief 015).
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>About Franki<\/a>/);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).startsWith("/api/") && !String(url).startsWith("/api/health"))).toEqual([]);
  });

  it("puts the radio on the stage, off, with its globe closed (brief 047)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const { App } = await import("./App");
    const html = renderToStaticMarkup(<App />);
    expect(html).toMatch(/<button[^>]*data-radio-button=""[^>]*aria-label="Turn on the radio"/);
    expect(html).toContain('data-radio-power="off"');
    expect(html).not.toContain("data-radio-panel");
  });

  it("puts the X-ray machine on the stage, off, with its screen closed and no camera asked for (brief 051)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const { App } = await import("./App");
    const html = renderToStaticMarkup(<App />);
    const button = html.match(/<button[^>]*data-xray-button=""[^>]*>/)?.[0] ?? "";
    expect(button).toContain('aria-label="Turn on the X-ray machine"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(html).toContain('data-xray-power="off"');
    expect(html).toContain('data-xray-signal="dark"');
    expect(html).not.toContain("data-xray-panel");
    // The machine stands in the stage's aside beside the radio.
    expect(html.indexOf("data-xray-button")).toBeGreaterThan(html.indexOf("data-radio-button"));
  });
});

describe("X-ray wiring (brief 051 part D)", () => {
  const src = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");

  it("holds one X-ray for the app's life, made on start and disposed on stop, the way the radio is", () => {
    expect(src.match(/createXrayHost\(/g)).toHaveLength(1);
    expect(src).toMatch(/const \[xrayHost\] = useState\(\(\) => createXrayHost\(\(\) => createLiveXray\(\)\)\);/);
    expect(src).toMatch(/xrayHost\.start\(\);\s*return \(\) => xrayHost\.stop\(\);\s*\}, \[xrayHost\]\);/);
    expect(src).toMatch(/useSyncExternalStore\(xrayHost\.subscribe, xrayHost\.getSnapshot, noXrayWatch\)/);
  });

  it("opens the camera only from a press: nothing in App.tsx presses or retries the machine but the stage's onPress", () => {
    expect(src.match(/xray\??\.controls\.(press|retry)\(/g)).toEqual(["xray?.controls.press("]);
    expect(src).toMatch(/<XrayOnStage view=\{xrayPropView\(xray\)\} onPress=\{onXray\} \/>/);
    expect(src).toMatch(/onXray=\{pressXray\}/);
  });

  it("puts the screen in the sheet slot after the radio's panel, in both MainScreen renders", () => {
    expect([...src.matchAll(/\{radioLayer\}\s*\{xrayLayer\}/g)]).toHaveLength(2);
    expect(src).not.toMatch(/sheet=\{radioLayer\}/);
  });

  it("shows the screen exactly while the machine is on, and hands focus back to the machine's button when it closes", () => {
    expect(src).toMatch(/xray !== null && xrayView\.power === "on" \? \(\s*<XrayPanel key="xray-panel" view=\{xrayView\} feed=\{xray\.feed\} controls=\{xray\.controls\}[^>]*onClosed=\{focusXrayButton\}/);
    expect(src).toMatch(/function focusXrayButton\(\): void \{\s*document\.querySelector<HTMLElement>\("\[data-xray-button\]"\)\?\.focus\(/);
  });
});

describe("Debug_Panel gating (R21)", () => {
  it("creates no DebugPanelModel without debug=1 or in production, so no GET /api/debug/memory is sent", () => {
    for (const flag of [debugVisible("development", ""), debugVisible("production", "?debug=1")]) {
      const { api, calls } = fakeApi();
      expect(flag).toBe(false);
      expect(controllers(flag, api).debug).toBeNull();
      expect(calls).toEqual([]);
    }
  });

  it("loads the Debug_Panel with debug=1 in development", async () => {
    const { api, calls } = fakeApi();
    const c = controllers(debugVisible("development", "?debug=1"), api);
    expect(c.debug).not.toBeNull();
    await c.debug!.refresh();
    expect(calls).toEqual(["/api/debug/memory"]);
  });
});

function screenRig(initial: Partial<VoiceState>) {
  const queue: ((t: number) => void)[] = [];
  let voice: VoiceState = { ...initialVoiceState({ transcribeModel: "m" }), ...initial };
  const screen = new ScreenController({
    scheduler: { request: (cb) => queue.push(cb), cancel: () => (queue.length = 0) },
    meter: { sample: () => ({ input: 0, output: 0 }), pause: () => {}, resume: () => {} },
    visibility: { isVisible: () => true, subscribe: () => () => {} },
    reduced: { getSnapshot: () => false, subscribe: () => () => {} },
    gestured: () => false,
    soundOn: () => true,
    sound: null,
    callErrors: CALL_ERRORS,
  });
  screen.setSources(true, { getSnapshot: () => voice });
  screen.start();
  const tick = (t: number) => queue.splice(0).forEach((cb) => cb(t));
  return { screen, tick, setVoice: (p: Partial<VoiceState>) => (voice = { ...voice, ...p }) };
}

describe("main-screen wiring", () => {
  it("passes no chips and no walked-in tap to the main screen (owner, Nov 13)", () => {
    const src = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");
    expect(src).not.toMatch(/\bchips=\{/);
    expect(src).not.toMatch(/<Chips\b|<CompanyToggle\b/);
  });

  it("makes one coalesced announcement for a state and call change in the same frame", () => {
    const r = screenRig({});
    r.tick(0);
    expect(r.screen.getSnapshot().live).toEqual({ message: null, seq: 0 });
    r.setVoice({ phase: "LISTENING" });
    r.tick(16);
    expect(r.screen.getSnapshot().live).toEqual({ message: "Franki is listening. Call connected.", seq: 1 });
    r.tick(32);
    expect(r.screen.getSnapshot().live.seq).toBe(1);
  });

  it("shows the Recovery look on a call error", () => {
    const r = screenRig({ phase: "LISTENING" });
    r.tick(0);
    r.setVoice({ phase: "RECOVERY", recovery: { kind: "connection", since: 0, attempts: 3 }, error: "open" });
    r.tick(16);
    const snap = r.screen.getSnapshot();
    expect(renderToStaticMarkup(<Avatar look={snap.look} input={snap.input} />)).toContain('data-look="Recovery"');
    expect(snap.live.message).toBe(`Franki is having trouble connecting. Reconnecting. ${CALL_ERRORS.open}`);
  });

  it("celebrate() shows the Celebrate look in a call, for the event's length, then goes back (brief 047)", () => {
    const r = screenRig({ phase: "LISTENING" });
    r.tick(0);
    expect(r.screen.getSnapshot().look.name).toBe("Listening");
    r.screen.celebrate();
    expect(r.screen.getSnapshot().look.name).toBe("Celebrate");
    r.tick(EVENT_MS.celebrate - 1);
    expect(r.screen.getSnapshot().look.name).toBe("Celebrate");
    r.tick(EVENT_MS.celebrate);
    expect(r.screen.getSnapshot().look.name).toBe("Listening");
  });

  it("celebrate() leaves a closed call Dormant (brief 047)", () => {
    const r = screenRig({});
    r.tick(0);
    r.screen.celebrate();
    expect(r.screen.getSnapshot().look.name).toBe("Dormant");
  });

  it("onForgetComplete empties the reply line and every turn copy", () => {
    const typed = new TypedTurns({ api: fakeApi().api, clock: clock() });
    (typed as unknown as { state: { entries: unknown[] } }).state.entries = [
      { key: "u", role: "user", text: "my dog is Pip" },
      { key: "f", role: "franki", text: "Pip it is." },
    ];
    expect(renderToStaticMarkup(<ReplyLine entries={typed.getSnapshot().entries} />)).toContain("Pip it is.");
    const copies = onForgetComplete(typed, { ...EMPTY_COPIES, reply: "Pip it is.", typedText: "x" });
    expect(copies).toEqual(EMPTY_COPIES);
    expect(renderToStaticMarkup(<ReplyLine entries={typed.getSnapshot().entries} />)).not.toContain("Pip");
  });
});
