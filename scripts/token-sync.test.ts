// Token sync (lab-ui-foundation R2.6, R2.7): every value hand-written in apps/web/src/ui/motion.ts
// equals the matching custom property in the `@theme static` block of globals.css.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { COLOR, DUR, EASE, SPRING, STAGGER } from "../apps/web/src/ui/motion";

const CSS = readFileSync(join(REPO_ROOT, "apps/web/src/app/globals.css"), "utf8");

/** Custom properties declared in the `@theme static { … }` block. */
function parseThemeStatic(css: string): Map<string, string> {
  const start = css.search(/@theme\s+static\s*\{/);
  if (start < 0) throw new Error("no @theme static block");
  let depth = 0;
  let i = css.indexOf("{", start);
  const open = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
  }
  const body = css.slice(open + 1, i).replace(/\/\*[\s\S]*?\*\//g, "");
  const props = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    props.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return props;
}

const ms = (v: string | undefined) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(v ?? "");
  if (!m) return NaN;
  return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
};

describe("token sync between globals.css and motion.ts", () => {
  const theme = parseThemeStatic(CSS);

  it("mirrors every colour token", () => {
    expect(Object.keys(COLOR)).toHaveLength(14);
    for (const [name, hex] of Object.entries(COLOR)) {
      expect(theme.get(`--color-${name}`)?.toUpperCase(), name).toBe(hex.toUpperCase());
    }
  });

  it("mirrors every spring", () => {
    for (const [name, spring] of Object.entries(SPRING)) {
      expect(Number(theme.get(`--spring-${name}-stiffness`)), name).toBe(spring.stiffness);
      expect(Number(theme.get(`--spring-${name}-damping`)), name).toBe(spring.damping);
    }
  });

  it("mirrors every duration and the stagger", () => {
    for (const [name, value] of Object.entries(DUR)) {
      expect(ms(theme.get(`--dur-${name}`)), name).toBe(value);
    }
    expect(ms(theme.get("--stagger"))).toBe(STAGGER);
  });

  it("mirrors the ecto easing", () => {
    const m = /^cubic-bezier\(([^)]*)\)$/.exec(theme.get("--ease-ecto") ?? "");
    expect(m).not.toBeNull();
    expect(m![1].split(",").map((x) => Number(x.trim()))).toEqual([...EASE.ecto]);
  });

  it("has no starter colours or Arial/Helvetica, and the body uses the three tokens", () => {
    for (const starter of ["#ffffff", "#171717", "#0a0a0a", "#ededed"]) {
      expect(CSS.toLowerCase()).not.toContain(starter);
    }
    expect(CSS).not.toMatch(/Arial|Helvetica/);
    const body = /(^|\n)body\s*\{([^}]*)\}/.exec(CSS)?.[2] ?? "";
    expect(body).toMatch(/background(-color)?:\s*var\(--color-night-0\)/);
    expect(body).toMatch(/(^|[\s;])color:\s*var\(--color-ink\)/);
    expect(body).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(theme.get("--font-sans")).toBe("var(--font-geist-sans)");
  });
});
