import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { OPEN_DEG } from "../../ui/landing/switch-blade";
import { DUR } from "../../ui/motion";
import { FOCUS } from "../surfaces/classes";
import { PIVOT, SPARK_MS, Switch } from "./Switch";

const CSS = readFileSync(join(__dirname, "lower.css"), "utf8");
const { wake } = LANDING.sections;
// Rendered with no router mounted: the router is only asked for once the switch is thrown.
const html = (reduced = false) => renderToStaticMarkup(<Switch href="/lab" onThrown={() => {}} reduced={reduced} />);

describe("Switch", () => {
  it("is the #wake section, titled by its h2", () => {
    const out = html();
    expect(out).toMatch(/<section id="wake" aria-labelledby="wake-title"/);
    expect(out).toContain(`<h2 id="wake-title" class="font-display text-title text-ink">${wake.title}</h2>`);
    expect(out).not.toContain("<h1");
  });

  it("is one button named by wake.lever, with a visible focus ring", () => {
    const out = html();
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toMatch(new RegExp(`<button type="button" aria-label="${wake.lever}"`));
    const cls = /<button[^>]*class="([^"]*)"/.exec(out)?.[1] ?? "";
    for (const c of FOCUS.split(" ")) expect(cls.split(" ")).toContain(c);
  });

  it("rests open at 38 degrees about the hinge pin", () => {
    const out = html();
    expect(OPEN_DEG).toBe(38);
    expect(out).toContain(`data-angle="${OPEN_DEG}"`);
    expect(out).toContain(`data-blade="" transform="rotate(${OPEN_DEG.toFixed(3)} ${PIVOT.x} ${PIVOT.y})"`);
    expect(out).toContain('data-phase="open"');
  });

  it("draws a glass base plate with four rivets, about 220 px tall, all decorative", () => {
    const out = html();
    const plate = out.split('data-base-plate=""')[1].split("</span><svg")[0];
    expect(out).toMatch(/data-base-plate=""[^>]*class="mat-glass /);
    expect(plate.match(/data-rivet=""/g)).toHaveLength(4);
    expect(out).toMatch(/<span aria-hidden="true" class="relative block size-\[220px\]">/);
    expect(out).toContain(`data-plate="brass"`);
  });

  it("gives the handle a light rim and a brass end cap, so it reads on the night behind it", () => {
    const out = html();
    expect(out).toMatch(/data-handle-body=""[^>]*stroke="color-mix\(in srgb, var\(--color-ink\) 40%, transparent\)"/);
    expect(out).toMatch(/data-handle-cap=""[^>]*fill="url\(#[^)]*-base\)"/);
    const handle = /<linearGradient id="[^"]*-handle"[^>]*>(.*?)<\/linearGradient>/.exec(out)?.[1] ?? "";
    expect(handle).toContain("var(--color-ink-dim)");
    expect(handle).not.toContain("var(--color-night-0)");
  });

  it("shows no spark until the blade meets the clips", () => {
    expect(html()).not.toContain("data-spark");
    expect(html()).not.toContain("data-electricity");
  });

  it("offers a plain link to the lab that works with scripting off, after the signature line, then the note", () => {
    const out = html();
    const sig = out.indexOf(wake.signature);
    const link = out.indexOf(`href="/lab"`);
    const note = out.indexOf(wake.note.replace(/'/g, "&#x27;"));
    expect(sig).toBeGreaterThan(out.indexOf("</button>"));
    expect(link).toBeGreaterThan(sig);
    expect(note).toBeGreaterThan(link);
    expect(out).toMatch(new RegExp(`<a href="/lab" class="[^"]*min-h-11[^"]*">${wake.walkIn}</a>`));
  });

  it("renders the same calm switch under reduced motion", () => {
    expect(html(true)).toContain(`data-angle="${OPEN_DEG}"`);
  });

  it("sparks for about 600 ms, the flash only with motion allowed", () => {
    expect(SPARK_MS).toBe(DUR.base * 2);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.lower-flash \{\s*animation: lower-flash calc\(var\(--dur-base\) \* 2\)/);
    expect(CSS).toMatch(/\[data-reduced="true"\] \.lower-flash \{\s*animation: none/);
  });

  it("lets a vertical swipe that starts on it scroll the page", () => {
    expect(CSS).toMatch(/\.lower-switch \{\s*touch-action: pan-y/);
  });
});
