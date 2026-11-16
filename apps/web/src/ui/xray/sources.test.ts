import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { XRAY_FACE_MODEL, XRAY_HAND_MODEL, XRAY_TRACKER_VERSION, XRAY_WASM_BASE } from "./sources";

const require = createRequire(import.meta.url);
// The package's exports do not list package.json, so it is read beside the resolved bundle.
const installed = (JSON.parse(readFileSync(join(dirname(require.resolve("@mediapipe/tasks-vision")), "package.json"), "utf8")) as { version: string }).version;
const declared = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> }).dependencies[
  "@mediapipe/tasks-vision"
];

describe("xray sources", () => {
  it("names the installed package's version, in the address too", () => {
    expect(XRAY_TRACKER_VERSION).toBe(installed);
    expect(declared).toBe(installed);
    expect(XRAY_WASM_BASE.match(/@mediapipe\/tasks-vision@([^/]+)\/wasm$/)?.[1]).toBe(installed);
  });

  it("serves every file over https from the two named hosts", () => {
    expect(new URL(XRAY_WASM_BASE).host).toBe("cdn.jsdelivr.net");
    for (const m of [XRAY_FACE_MODEL, XRAY_HAND_MODEL]) {
      expect(new URL(m).protocol).toBe("https:");
      expect(new URL(m).host).toBe("storage.googleapis.com");
      expect(m.endsWith(".task")).toBe(true);
    }
  });
});
