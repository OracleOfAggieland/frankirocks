import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SPRING } from "../../ui/motion";
import type { CardProps } from "../../ui/surface-props";
import { CardDock, STACK_PEEK, STACK_SCALES, dockMotion, frontExtras, leavingProps, stackPose } from "./CardDock";

// Records the props each AnimatePresence is given, and renders the real one.
const presence = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("motion/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("motion/react")>();
  function AnimatePresence(props: ComponentProps<typeof real.AnimatePresence>) {
    presence.calls.push(props as Record<string, unknown>);
    return <real.AnimatePresence {...props} />;
  }
  return { ...real, AnimatePresence };
});
beforeEach(() => {
  presence.calls.length = 0;
});

const card = (id: string): CardProps => ({ kind: "read", id, title: `Card ${id}`, sources: [], onOpenSource: () => {}, lines: [`line ${id}`] });

describe("CardDock", () => {
  it("shows one primary card and stacks up to two older ones smaller", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a"), card("b"), card("c"), card("d")]} />);
    expect(html.match(/data-depth="/g)).toHaveLength(3);
    expect(html).toContain('data-depth="0" data-scale="1"');
    expect(html).toContain('data-depth="1" data-scale="0.96"');
    expect(html).toContain('data-depth="2" data-scale="0.92"');
    expect(html).not.toContain("Card d");
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.indexOf('data-depth="0"')).toBeGreaterThan(html.indexOf('data-depth="2"'));
  });

  it("older cards show only their edges: no content, inert and hidden", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a"), card("b"), card("c")]} />);
    expect(html).toContain("Card a");
    expect(html).toContain("line a");
    for (const older of ["Card b", "line b", "Card c", "line c"]) expect(html).not.toContain(older);
    expect(html.match(/data-stack-edge=""/g)).toHaveLength(2);
    expect(html.match(/data-card="/g)).toHaveLength(1);
    for (const depth of [1, 2]) {
      const tag = new RegExp(`<div[^>]*data-depth="${depth}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(tag).toContain('aria-hidden="true"');
      expect(tag).toContain("inert");
    }
    const front = /<div[^>]*data-depth="0"[^>]*>/.exec(html)?.[0] ?? "";
    expect(front).not.toContain("aria-hidden");
    expect(front).not.toContain("inert");
  });

  it("is a bottom sheet below 1024 px and a column from 1024 px", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a")]} />);
    expect(html).toMatch(/class="fixed inset-x-0 bottom-0[^"]*lg:static/);
  });

  it("older cards are glass shells", () => {
    const html = renderToStaticMarkup(<CardDock cards={[card("a"), card("b")]} />);
    expect(html).toMatch(/data-stack-edge="" class="mat-glass [^"]*rounded-card/);
  });

  it("a card enters from Franki's side by materializing and leaves by dematerializing", () => {
    for (const depth of [0, 1, 2]) {
      const m = dockMotion(depth, false);
      const rest = stackPose(depth);
      expect(m.animate).toEqual(rest);
      // From the stage side (the left), rising 12 px, faded out.
      expect(m.initial).toMatchObject({ opacity: 0, x: -24, y: 12 });
      // Rising 8 px from where it rests, fading, blurring to 6 px.
      expect(m.exit).toEqual({ opacity: 0, y: rest.y - 8, filter: "blur(6px)" });
      // A resting card has no filter, so its glass still blurs what is behind it.
      expect(m.animate).not.toHaveProperty("filter");
      expect(m.transition).toMatchObject({ y: { type: "spring", ...SPRING.settle } });
    }
    expect(stackPose(1)).toMatchObject({ opacity: 0.75, y: -STACK_PEEK, scale: STACK_SCALES[1] });
  });

  it("under reduced motion a card only fades in and out", () => {
    for (const depth of [0, 1, 2]) {
      const m = dockMotion(depth, true);
      expect(m.initial).toEqual({ opacity: 0 });
      expect(m.exit).toEqual({ opacity: 0 });
      expect(m.transition).not.toHaveProperty("type");
      expect(JSON.stringify(m)).not.toContain("blur");
    }
  });

  const source = (id: string, value: string): CardProps => ({ kind: "source", id, title: `Card ${id}`, sources: [{ id: "bank", label: "Bank" }], onOpenSource: () => {}, body: "Mostly late.", figures: [{ label: "This month", value, sourceId: "bank" }] });
  const bankRows = (amount: string) => ({ bank: [{ id: "r1", when: "Oct 2", what: "Takeout", amount }] });

  it("passes source rows to the front card only, by card ID", () => {
    const html = renderToStaticMarkup(<CardDock cards={[source("s", "$186"), card("b")]} sourceRows={{ s: bankRows("$30") }} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/aria-expanded=/g)).toHaveLength(1);
  });

  it("two cards citing the same source ID each open their own rows", () => {
    const sourceRows = { s: bankRows("$186"), t: bankRows("$71") };
    const open = { s: "bank", t: "bank" };
    const first = renderToStaticMarkup(<CardDock cards={[source("s", "$186"), source("t", "$71")]} sourceRows={sourceRows} defaultOpenSource={open} />);
    expect(first).toMatch(/>\$186<\/td>/);
    expect(first).not.toMatch(/>\$71<\/td>/);
    const second = renderToStaticMarkup(<CardDock cards={[source("t", "$71")]} sourceRows={sourceRows} defaultOpenSource={open} />);
    expect(second).toMatch(/>\$71<\/td>/);
    expect(second).not.toMatch(/>\$186<\/td>/);
    // A card with no entry gets no rows at all.
    const none = renderToStaticMarkup(<CardDock cards={[source("u", "$5")]} sourceRows={sourceRows} defaultOpenSource={open} />);
    expect(none).not.toContain("aria-expanded");
  });

  it("can show the front card's rows open without a tap, held by the host or as a first state", () => {
    const rows = { s: bankRows("$30") };
    expect(renderToStaticMarkup(<CardDock cards={[source("s", "$186")]} sourceRows={rows} defaultOpenSource={{ s: "bank" }} />)).toContain("data-source-rows");
    expect(renderToStaticMarkup(<CardDock cards={[source("s", "$186")]} sourceRows={rows} openSource={{ s: "bank" }} />)).toContain("data-source-rows");
    expect(renderToStaticMarkup(<CardDock cards={[source("s", "$186")]} sourceRows={rows} openSource={{ s: null }} defaultOpenSource={{ s: "bank" }} />)).not.toContain("data-source-rows");
    expect(frontExtras("s", { sourceRows: rows, defaultOpenSource: { s: "bank" }, openSource: { s: null } })).toEqual({ sourceRows: rows.s, defaultOpenSource: "bank", openSource: null });
    // A card the maps do not name gets nothing, so it keeps its own open state.
    expect(frontExtras("x", { sourceRows: rows, defaultOpenSource: { s: "bank" }, openSource: { s: null } })).toEqual({});
  });

  it("tells the host when the last card has finished leaving", () => {
    const done = () => {};
    renderToStaticMarkup(<CardDock cards={[card("a")]} onExitComplete={done} />);
    // The outer AnimatePresence holds the dock; the inner one holds the cards.
    expect(presence.calls[0]?.onExitComplete).toBe(done);
    expect(presence.calls.slice(1).every((p) => p.onExitComplete === undefined)).toBe(true);
  });

  it("a leaving card, and a leaving dock, are inert and hidden", () => {
    expect(leavingProps(true)).toEqual({});
    expect(leavingProps(false)).toEqual({ inert: true, "aria-hidden": true, "data-leaving": "" });
    // While present, nothing in the front card is inert.
    const html = renderToStaticMarkup(<CardDock cards={[card("a")]} />);
    expect(html).not.toContain("data-leaving");
    expect(html).not.toContain("inert");
  });

  it("renders nothing with no cards", () => {
    expect(renderToStaticMarkup(<CardDock cards={[]} />)).toBe("");
    expect(renderToStaticMarkup(<CardDock cards={[{ ...card("x"), title: "" }]} />)).toBe("");
  });
});
