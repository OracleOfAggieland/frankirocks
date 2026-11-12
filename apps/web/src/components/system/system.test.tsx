import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COLOR } from "../../ui/motion";
import { FuseDrawing } from "./FuseDrawing";
import { FUSE_COPY, FuseRoom } from "./FuseRoom";
import { NOT_FOUND_COPY, NotFoundRoom } from "./NotFoundRoom";
import { SlabDrawing } from "./SlabDrawing";

const { default: NotFoundPage, metadata: notFoundMetadata } = await import("../../app/not-found");
const { default: ErrorPage } = await import("../../app/error");
const { default: manifest } = await import("../../app/manifest");

const APP = join(import.meta.dirname, "..", "..", "app");
const noop = () => {};
const count = (html: string, needle: string) => html.split(needle).length - 1;
const anchors = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);

describe("404: the empty room (brief 015 J)", () => {
  const html = renderToStaticMarkup(<NotFoundRoom />);

  it("has one h1, in display type, with at most one italic word", () => {
    expect(count(html, "<h1")).toBe(1);
    expect(html).toMatch(/<h1 class="[^"]*font-display[^"]*text-title/);
    expect(count(html, "<em")).toBe(1);
    expect(html).toContain(`${NOT_FOUND_COPY.titleStart} <em class="italic">${NOT_FOUND_COPY.titleWord}</em>`);
  });

  it("links home in brass and to the lab quietly, each a 44 px target with a focus ring", () => {
    const [home, lab] = anchors(html);
    expect(home).toContain('href="/"');
    expect(home).toContain("mat-brass");
    expect(lab).toContain('href="/lab"');
    expect(lab).not.toContain("mat-brass");
    for (const a of [home, lab]) {
      expect(a).toContain("min-h-11");
      expect(a).toContain("focus-visible:outline-brass-hi");
    }
    expect(html.indexOf(NOT_FOUND_COPY.home)).toBeLessThan(html.indexOf(NOT_FOUND_COPY.lab));
  });

  it("draws the slab and a dashed outline where Franki would float, as decoration, with a fig label", () => {
    expect(html).toMatch(/<svg aria-hidden="true" focusable="false" data-drawing="slab"[^>]*class="mat-blueprint pointer-events-none/);
    expect(html).toContain('data-part="slab"');
    expect(html).toMatch(/data-part="absent" class="sys-float /);
    expect(html).toContain('data-fig="404"');
    expect(html).toContain(NOT_FOUND_COPY.fig);
    expect(html).not.toMatch(/ember/);
  });

  it("sits on the door backdrop and leaves the footer to the root layout", () => {
    expect(html).toContain("data-backdrop");
    expect(html).not.toContain("<footer");
    expect(html).toMatch(/^<main data-system="not-found"/);
  });

  it("hides the drawing's figure from screen readers and raises no alert", () => {
    expect(html).toMatch(/<figure aria-hidden="true"/);
    expect(html).not.toContain('role="alert"');
  });

  it("the page file renders the room and names the tab", () => {
    expect(renderToStaticMarkup(<NotFoundPage />)).toBe(html);
    expect(notFoundMetadata.title).toBe(NOT_FOUND_COPY.docTitle);
  });
});

describe("Error: the blown fuse (brief 015 J)", () => {
  const html = renderToStaticMarkup(<FuseRoom onRetry={noop} />);

  it("has one h1 in display type", () => {
    expect(count(html, "<h1")).toBe(1);
    expect(html).toMatch(/<h1 class="[^"]*font-display[^"]*text-title/);
    expect(html).toContain(`${FUSE_COPY.titleStart} <em class="italic">${FUSE_COPY.titleWord}</em>`);
  });

  it("offers a brass button to try again and a quiet link home", () => {
    expect(html).toMatch(new RegExp(`<button type="button" class="[^"]*mat-brass[^"]*">${FUSE_COPY.retry}</button>`));
    const [home] = anchors(html);
    expect(home).toContain('href="/"');
    expect(home).not.toContain("mat-brass");
    expect(home).toContain("min-h-11");
  });

  it("the link home is a plain anchor, so it does a full page load after a crash", () => {
    const src = readFileSync(join(import.meta.dirname, "FuseRoom.tsx"), "utf8");
    expect(src).not.toMatch(/from "next\/link"/);
  });

  it("the retry button calls the handler it is given", () => {
    const spy = () => {};
    const room = FuseRoom({ onRetry: spy });
    expect(room.props.actions.props.children[0].type).toBe("button");
    expect(room.props.actions.props.children[0].props.onClick).toBe(spy);
  });

  it("announces the swap: the title and text sit in an alert, the figure is hidden", () => {
    expect(html).toMatch(/<figure aria-hidden="true"/);
    const alert = html.match(/<div role="alert"[^>]*>([\s\S]*?)<\/div>/);
    expect(alert).not.toBeNull();
    expect(alert![1]).toContain("<h1");
    expect(alert![1]).toContain(FUSE_COPY.body);
  });

  it("draws the break in ember and nothing else in ember", () => {
    expect(html).toMatch(/<svg aria-hidden="true" focusable="false" data-drawing="fuse"/);
    const start = html.indexOf('<g data-part="break"');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf("</svg>", start);
    const brk = html.slice(start, end);
    const rest = html.slice(0, start) + html.slice(end);
    expect(brk).toMatch(/stroke-ember/);
    expect(brk).toMatch(/fill-ember/);
    expect(rest).not.toMatch(/ember/);
    expect(html).toContain('data-fig="500"');
  });

  it("draws no electricity", () => {
    expect(html).not.toMatch(/spark|bolt|electric/i);
  });

  it("the error page is a client component that wires retry and sets the tab title", () => {
    const src = readFileSync(join(APP, "error.tsx"), "utf8");
    expect(src.startsWith('"use client";')).toBe(true);
    expect(src).toMatch(/<FuseRoom onRetry=\{retry\}/);
    const page = renderToStaticMarkup(<ErrorPage error={new Error("internal detail 7f3a")} retry={noop} reset={noop} />);
    expect(page).toContain(`<title>${FUSE_COPY.docTitle}</title>`);
    expect(page).toContain(html);
    expect(page).not.toContain("internal detail 7f3a");
  });
});

describe("the drawings", () => {
  it("use only stitch linework, ink-dim light and (for the fuse) ember: no raw colour", () => {
    for (const html of [renderToStaticMarkup(<SlabDrawing />), renderToStaticMarkup(<FuseDrawing />)]) {
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/(brass|gold|ecto)/);
    }
  });
});

describe("system.css loops", () => {
  const css = readFileSync(join(import.meta.dirname, "system.css"), "utf8");
  const motion = css.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g) ?? [];

  it("run only under no-preference, stop when reduced is forced, and pause when hidden", () => {
    for (const loop of ["sys-float", "sys-floor", "sys-ember"]) {
      const infinite = [...css.matchAll(new RegExp(`animation: ${loop} [^;]*infinite`, "g"))];
      expect(infinite.length, loop).toBe(1);
      expect(motion.some((block) => block.includes(`animation: ${loop} `)), loop).toBe(true);
      expect(css).toMatch(new RegExp(`\\[data-reduced="true"\\] \\.${loop}[,\\s]`));
    }
    expect(css).toMatch(/\[data-paused="true"\] \.sys-anim \{\s*animation-play-state: paused !important;/);
  });

  it("animate only transform and opacity", () => {
    const frames = [...css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(0);
    for (const body of frames) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity"]).toContain(p);
    }
  });
});

describe("icon and manifest", () => {
  it("the icon uses only token colours", () => {
    const svg = readFileSync(join(APP, "icon.svg"), "utf8");
    const tokens = new Set(Object.values(COLOR).map((c) => c.toUpperCase()));
    const used = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toUpperCase());
    expect(used.length).toBeGreaterThan(0);
    for (const hex of used) expect(tokens.has(hex), hex).toBe(true);
    expect(svg).toContain('viewBox="0 0 32 32"');
  });

  it("the manifest names Franki, takes its colours from the tokens and points at the icon", () => {
    const m = manifest();
    expect(m.name).toBe("Franki");
    expect(m.short_name).toBe("Franki");
    expect(m.start_url).toBe("/");
    expect(m.background_color).toBe(COLOR["night-0"]);
    expect(m.theme_color).toBe(COLOR["night-0"]);
    expect(m.icons).toEqual([{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }]);
  });
});
