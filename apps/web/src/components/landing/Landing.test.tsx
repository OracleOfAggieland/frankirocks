import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LANDING, type StepCopy } from "../../ui/copy-landing";
import { STEP_IDS } from "../../ui/landing/steps";

// The stage, the lower sections and the backdrop belong to other packages. They are stood in for here, so this
// file tests only the page's own frame: order, grid, the step handed down, and that nothing above the stage clips.
const seen = vi.hoisted(() => ({ stage: [] as unknown[], backdrop: [] as unknown[] }));
vi.mock("./DemoStage", () => ({
  DemoStage: (props: unknown) => {
    seen.stage.push(props);
    return <section data-demo-stage="" />;
  },
}));
vi.mock("./HouseRules", () => ({ HouseRules: () => <section id="rules" data-mock="rules" /> }));
vi.mock("./Build", () => ({ Build: () => <section id="build" data-mock="build" /> }));
vi.mock("./Switch", () => ({ Switch: () => <section id="wake" data-mock="wake" /> }));
vi.mock("../screen/Backdrop", () => ({
  Backdrop: (props: unknown) => {
    seen.backdrop.push(props);
    return <div data-backdrop="" />;
  },
}));

const { Landing } = await import("./Landing");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the front door page (brief 015 H1)", () => {
  it("renders the page in order: bar, rail, hero, stage, story, then the lower sections", () => {
    const html = renderToStaticMarkup(<Landing />);
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [
      "data-landing-bar",
      "data-rail=",
      'id="top"',
      "data-stage-column",
      "data-demo-stage",
      'id="story"',
      'id="loop"',
      'id="memory"',
      'id="rules"',
      'id="build"',
      'id="wake"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
  });

  it("cancels the rail's extra left padding around the switch, so it centres on the viewport", () => {
    const html = renderToStaticMarkup(<Landing />);
    expect(html).toContain('<div class="lg:-ml-20 min-[1400px]:-ml-24"><section id="wake"');
    expect(html).toMatch(/<main class="[^"]*lg:pl-28 lg:pr-8 min-\[1400px\]:pl-32/);
  });

  it("renders the door backdrop", () => {
    seen.backdrop.length = 0;
    renderToStaticMarkup(<Landing />);
    expect(seen.backdrop).toEqual([{ variant: "door" }]);
  });

  it("hands the stage the hero step, the default toy and calm motion on the server", () => {
    seen.stage.length = 0;
    renderToStaticMarkup(<Landing />);
    expect(seen.stage).toHaveLength(1);
    expect(seen.stage[0]).toMatchObject({ step: "hero", toy: "listening", reduced: true });
    const props = seen.stage[0] as { onToy: unknown; onYes: unknown };
    expect(typeof props.onToy).toBe("function");
    expect(typeof props.onYes).toBe("function");
  });

  it("lays out two columns from 1024 px with the stage spanning both rows, sticky under the bar", () => {
    const html = renderToStaticMarkup(<Landing />);
    expect(html).toMatch(/data-door-grid="" class="grid grid-cols-1 lg:grid-cols-\[minmax\(0,5fr\)_minmax\(0,6fr\)\]/);
    const stage = /data-stage-column="" class="([^"]*)"/.exec(html)![1]!.split(" ");
    for (const cls of ["sticky", "top-14", "md:top-16", "h-[44svh]", "self-start", "lg:col-start-2", "lg:row-start-1", "lg:row-span-2", "lg:h-[calc(100svh-4rem)]"]) {
      expect(stage, cls).toContain(cls);
    }
    // Below 1024 px the pinned stage has a night-0 ground, and so does the story passing under it.
    expect(stage).toContain("max-lg:bg-night-0");
    expect(/id="story" data-story="" class="([^"]*)"/.exec(html)![1]).toContain("max-lg:bg-night-0");
  });

  it("never clips: no overflow hidden or clip anywhere in the page's own frame", () => {
    const html = renderToStaticMarkup(<Landing />);
    expect(html).not.toMatch(/overflow-(hidden|clip)|overflow:\s*(hidden|clip)|clip-path/);
  });

  it("reads completely with scripting off: every story word is in the HTML at full strength", () => {
    const html = renderToStaticMarkup(<Landing />);
    const words = text(html);
    for (const id of STEP_IDS) {
      const copy: StepCopy = LANDING.steps[id];
      for (const s of [copy.kicker, copy.title, copy.body, copy.says, copy.hint]) {
        if (typeof s === "string" && s !== "") expect(words, `${id}: ${s}`).toContain(s.replace(/'/g, "&#x27;"));
      }
    }
    expect(html).not.toContain("opacity-35");
  });
});
