// Brief 051, "The picture never leaves the browser": no upload, no recording, no saved image, nothing written to
// storage, nothing added to the voice call. This pins it over every X-ray source file that ships or that the
// specimens run: no file names any of the brief's listed APIs, anywhere in it, comments included. `captureStream`
// (the specimens' still-picture camera) is allowed. Test files are not read.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** The brief's list, matched as plain text: a longer name that holds one (say `prefetch`) trips it too. */
const NEVER = ["MediaRecorder", "RTCPeerConnection", "toDataURL", "toBlob", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "fetch"] as const;

const SRC = join(import.meta.dirname, "..", "..");
const isSource = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : isSource(name) ? [path] : [];
  });
}

/** Every X-ray source file: ui/xray/ and components/xray/ whole, and the client's xray-* files and their fakes. */
function xrayFiles(): string[] {
  const client = join(SRC, "client");
  const clientFiles = readdirSync(client)
    .filter((f) => f.startsWith("xray-") && isSource(f))
    .map((f) => join(client, f));
  const fakes = readdirSync(join(client, "testing"))
    .filter((f) => f.startsWith("xray-") && isSource(f))
    .map((f) => join(client, "testing", f));
  return [...walk(join(SRC, "ui", "xray")), ...walk(join(SRC, "components", "xray")), ...clientFiles, ...fakes];
}

const named = (text: string) => NEVER.filter((api) => text.includes(api));

describe("the X-ray's picture never leaves the browser", () => {
  const files = xrayFiles();
  const rel = (f: string) => relative(SRC, f).replaceAll("\\", "/");

  it("reads every part's files: the machine, the store and its ports, the stage machine and the screen", () => {
    const got = files.map(rel);
    for (const f of [
      "ui/xray/types.ts",
      "ui/xray/xray-machine.ts",
      "ui/xray/sources.ts",
      "ui/xray/testing/scripted-frames.ts",
      "client/xray-camera.ts",
      "client/xray-tracker.ts",
      "client/xray-watch.ts",
      "client/xray-live.ts",
      "components/xray/XrayOnStage.tsx",
      "components/xray/ThreeXray.tsx",
      "components/xray/three/engine.ts",
      "components/xray/XrayPanel.tsx",
      "components/xray/ThreeBones.tsx",
      "components/xray/anatomy/engine.ts",
    ])
      expect(got).toContain(f);
    expect(got.some((f) => f.includes(".test."))).toBe(false);
  });

  it("finds each listed name in a line that holds it, so a quiet pass means none is there", () => {
    for (const api of NEVER) expect(named(`const x = window.${api};`)).toContain(api);
    expect(named("canvas.captureStream(15)")).toEqual([]);
  });

  it("no X-ray source file names any of them", () => {
    const found = files.flatMap((f) => named(readFileSync(f, "utf8")).map((api) => `${rel(f)}: ${api}`));
    expect(found).toEqual([]);
  });

  it("asks for no sound: the camera request is video only", () => {
    const camera = readFileSync(join(SRC, "client", "xray-camera.ts"), "utf8");
    expect(camera).toMatch(/audio:\s*false/);
    expect(camera).not.toMatch(/audio:\s*true/);
  });
});
