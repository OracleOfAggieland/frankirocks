// The three.js renderer's server render and its one way into the engine (brief 013, design note §6 and §8.1 WP12).
// `three` is mocked with a factory that throws, so any import of it during these renders fails the test. The static
// walk proves no file the Avatar slot reaches value-imports anything under three/: the engine arrives only through
// the dynamic import in three-host.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { findTokenViolations } from "../../../../../scripts/token-check.mjs";
import { importsOf, resolveModule } from "../../../../../scripts/ui-boundaries.mjs";
import { LOOK_NAMES, lookFor } from "../../ui/avatar/look";
import type { AvatarInput, LookName } from "../../ui/avatar/types";
import { Avatar } from "./Avatar";
import { CANVAS_FRAME } from "./canvas-frame";
import { CANVAS_LAYER_CLASS, SVG_LAYER_CLASS, ThreeGhost, canvasFrameStyle, createThreeGhost } from "./ThreeGhost";
import { FLOAT_BUFFER_EXTENSIONS, type ProbeDocument, browserThreeHost, memoisedProbe, probeDocument } from "./three-host";

vi.mock("three", () => {
  throw new Error("three.js was imported during a server render");
});

const REPO = join(__dirname, "../../../../..");
const THREE_DIR = "apps/web/src/components/avatar/three/";

const BASE: AvatarInput = {
  state: "thinking",
  micMuted: false,
  outputMuted: false,
  inputLevel: 0,
  outputLevel: 0,
  event: null,
  eventElapsedMs: 0,
  firstConnecting: false,
  reducedMotion: false,
};

/** One input per LookName. */
const INPUT_FOR: Record<LookName, Partial<AvatarInput>> = {
  Dormant: { state: "closed" },
  Waking: { state: "connecting", event: "wake" },
  Connecting: { state: "connecting" },
  Listening: { state: "listening", inputLevel: 0.4 },
  Thinking: { state: "thinking" },
  Speaking: { state: "speaking", outputLevel: 0.6 },
  Recovery: { state: "recovery" },
  Presenting: { state: "thinking", event: "present-card" },
  Awaiting_Approval: { state: "listening", event: "await-approval" },
  Celebrate: { state: "thinking", event: "celebrate" },
};

function cases(): { label: string; input: AvatarInput }[] {
  const out: { label: string; input: AvatarInput }[] = [];
  for (const name of LOOK_NAMES) {
    for (const micMuted of [false, true]) {
      for (const reducedMotion of [false, true]) {
        out.push({ label: `${name} ghost=${micMuted} reduced=${reducedMotion}`, input: { ...BASE, ...INPUT_FOR[name], micMuted, reducedMotion } });
      }
    }
  }
  return out;
}

describe("ThreeGhost: server render", () => {
  it("covers every LookName", () => {
    for (const name of LOOK_NAMES) expect(lookFor({ ...BASE, ...INPUT_FOR[name] }).name).toBe(name);
  });

  for (const { label, input } of cases()) {
    it(`renders the SVG ghost with no canvas and no three.js: ${label}`, () => {
      const html = renderToStaticMarkup(<Avatar look={lookFor(input)} input={input} renderer={ThreeGhost} />);
      expect(html).toContain('data-renderer="svg-ghost"');
      expect(html).toContain('data-three-phase="svg"');
      expect(html).toContain('data-three-layer="svg"');
      expect(html).not.toContain('data-three-layer="canvas"');
      expect(html).not.toContain("<canvas");
      expect(html.match(/role="img"/g)).toHaveLength(1);
      expect(html).toContain(`aria-label="${lookFor(input).label}"`);
    });
  }

  it("the default Avatar still renders the SVG ghost on the server", () => {
    const html = renderToStaticMarkup(<Avatar look={lookFor(BASE)} input={BASE} />);
    expect(html).toContain('data-renderer="svg-ghost"');
    expect(html).not.toContain("<canvas");
  });

  it("builds its dependencies at render without touching a browser global", () => {
    const makeDeps = vi.fn(browserThreeHost);
    const Renderer = createThreeGhost(makeDeps);
    const html = renderToStaticMarkup(<Renderer look={lookFor(BASE)} input={BASE} />);
    expect(makeDeps).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-three-phase="svg"');
  });

  it("keeps the SVG ghost's own box, so the stage never changes size between phases", () => {
    const html = renderToStaticMarkup(<Avatar look={lookFor(BASE)} input={BASE} renderer={ThreeGhost} />);
    expect(html).toMatch(/class="relative isolate aspect-\[10\/11\] w-full" data-three-phase="svg"/);
  });
});

describe("ThreeGhost: layers", () => {
  it("places the canvas layer by CANVAS_FRAME, in box widths across and box heights down", () => {
    expect(canvasFrameStyle({ left: -0.3, top: -0.25, width: 1.6, height: 1.6 })).toEqual({
      left: "-30.0000%",
      top: `${((-0.25 / 1.1) * 100).toFixed(4)}%`,
      width: "160.0000%",
      height: `${((1.6 / 1.1) * 100).toFixed(4)}%`,
    });
    expect(canvasFrameStyle(CANVAS_FRAME).width).toBe(`${(CANVAS_FRAME.width * 100).toFixed(4)}%`);
  });

  it("sets opacity by class only, with token durations and easing", () => {
    for (const cls of [...Object.values(CANVAS_LAYER_CLASS), ...Object.values(SVG_LAYER_CLASS)]) {
      expect(findTokenViolations("apps/web/src/components/avatar/ThreeGhost.tsx", `className="${cls}"`)).toEqual([]);
    }
    expect(SVG_LAYER_CLASS.leaving).toContain("delay-(--dur-base)");
    expect(CANVAS_LAYER_CLASS.entering).not.toContain("delay-");
    expect(SVG_LAYER_CLASS.entering).toBe("franki-fade");
    expect(CANVAS_LAYER_CLASS.hidden).toBe("opacity-0");
  });
});

describe("three-host: the WebGL 2 probe", () => {
  function fakeDoc(ctx: { extensions: string[] } | null, counter = { contexts: 0, lost: 0 }): ProbeDocument {
    return {
      createElement: () => ({
        getContext: () => {
          if (ctx === null) return null;
          counter.contexts++;
          return {
            getExtension: (name: string) => {
              if (name === "WEBGL_lose_context") return { loseContext: () => counter.lost++ };
              return ctx.extensions.includes(name) ? {} : null;
            },
          };
        },
      }),
    };
  }

  it("needs WebGL 2 and one of the float colour buffer extensions", () => {
    expect(probeDocument(fakeDoc(null))).toBe(false);
    expect(probeDocument(fakeDoc({ extensions: [] }))).toBe(false);
    for (const ext of FLOAT_BUFFER_EXTENSIONS) expect(probeDocument(fakeDoc({ extensions: [ext] }))).toBe(true);
  });

  it("frees the throwaway context at once", () => {
    const counter = { contexts: 0, lost: 0 };
    probeDocument(fakeDoc({ extensions: ["EXT_color_buffer_float"] }, counter));
    expect(counter).toEqual({ contexts: 1, lost: 1 });
  });

  it("reads a throw as no support", () => {
    const throwing: ProbeDocument = {
      createElement: () => {
        throw new Error("blocked");
      },
    };
    expect(probeDocument(throwing)).toBe(false);
  });

  it("probes once per page, and not at all without a document", () => {
    const counter = { contexts: 0, lost: 0 };
    let doc: ProbeDocument | null = null;
    const probe = memoisedProbe(() => doc);
    expect(probe()).toBe(false);
    doc = fakeDoc({ extensions: ["EXT_color_buffer_half_float"] }, counter);
    expect(probe()).toBe(true);
    expect(probe()).toBe(true);
    expect(counter.contexts).toBe(1);
  });

  it("the browser host's probe is safe on the server", () => {
    expect(browserThreeHost().probeWebGL2()).toBe(false);
  });
});

describe("ThreeGhost: the one way into three/", () => {
  const exists = (rel: string) => existsSync(join(REPO, rel));
  const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

  /** True when the import at this line is a dynamic import() of this specifier, which is a split point. */
  function isDynamic(text: string, line: number, specifier: string): boolean {
    const src = text.split("\n")[line - 1] ?? "";
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\bimport\\s*\\(\\s*["'\`]${escaped}["'\`]`).test(src);
  }

  /** Every module reachable by static value imports from the entries, within apps/web/src. */
  function walk(entries: string[]): { reached: Set<string>; bad: string[] } {
    const reached = new Set<string>();
    const bad: string[] = [];
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (reached.has(file)) continue;
      reached.add(file);
      const text = read(file);
      for (const { specifier, line, typeOnly } of importsOf(text) as { specifier: string; line: number; typeOnly: boolean }[]) {
        if (typeOnly || isDynamic(text, line, specifier)) continue;
        if (specifier === "three" || specifier.startsWith("three/")) {
          bad.push(`${file}:${line} imports ${specifier}`);
          continue;
        }
        const target = resolveModule(file, specifier, exists) as string | null;
        if (target === null || !target.startsWith("apps/web/src/")) continue;
        if (target.startsWith(THREE_DIR)) {
          bad.push(`${file}:${line} imports ${target}`);
          continue;
        }
        queue.push(target);
      }
    }
    return { reached, bad };
  }

  it("no static import from the Avatar slot or the three.js renderer reaches three/ or the three package", () => {
    const { reached, bad } = walk(["apps/web/src/components/avatar/Avatar.tsx", "apps/web/src/components/avatar/ThreeGhost.tsx"]);
    expect(bad).toEqual([]);
    // The walk really went through the renderer's own files.
    expect(reached).toContain("apps/web/src/components/avatar/three-ghost-controller.ts");
    expect(reached).toContain("apps/web/src/components/avatar/three-host.ts");
    expect(reached).toContain("apps/web/src/components/avatar/SvgGhost.tsx");
  });

  it("the engine is reached only by the one dynamic import in three-host.ts", () => {
    const host = read("apps/web/src/components/avatar/three-host.ts");
    const lines = host.split("\n");
    // importsOf reads comments too; the doc comment that names the import is not a second one.
    const isComment = (line: number) => /^\s*(\*|\/\*|\/\/)/.test(lines[line - 1] ?? "");
    const engineImports = (importsOf(host) as { specifier: string; line: number; typeOnly: boolean }[]).filter(
      (i) => i.specifier === "./three/engine" && !isComment(i.line),
    );
    const dynamic = engineImports.filter((i) => isDynamic(host, i.line, i.specifier));
    expect(dynamic).toHaveLength(1);
    expect(engineImports.filter((i) => !i.typeOnly && !isDynamic(host, i.line, i.specifier))).toEqual([]);
  });

  it("the walk catches a static import into three/ (it is not vacuous)", () => {
    const text = 'import { createEngine } from "./three/engine";\nimport type { X } from "./three/loop";\n';
    const found = (importsOf(text) as { specifier: string; line: number; typeOnly: boolean }[]).filter((i) => !i.typeOnly && !isDynamic(text, i.line, i.specifier));
    expect(found.map((i) => i.specifier)).toEqual(["./three/engine"]);
  });
});
