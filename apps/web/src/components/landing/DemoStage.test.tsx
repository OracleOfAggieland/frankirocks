import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AVATAR_LABELS } from "../../ui/copy";
import { LANDING } from "../../ui/copy-landing";
import { FORGOTTEN_ID, KNOWN_ITEMS, KNOWN_MOTES } from "../../ui/landing/sample";
import { type StageScene, allScenes, stageFor } from "../../ui/landing/stage-script";
import { type StepId, TOY_STATES } from "../../ui/landing/steps";
import { DemoStage, FIT_MIN, NARROW_PX, ROWS_MIN_HEIGHT_PX, SHEET_FIT_MIN, StageView, boxFacts, fitScale } from "./DemoStage";

const noop = () => {};

function view(scene: StageScene, o: Partial<{ narrow: boolean; rows: boolean; awake: boolean; reduced: boolean }> = {}) {
  return renderToStaticMarkup(
    <StageView
      scene={scene}
      toy="listening"
      onToy={noop}
      onYes={noop}
      reduced={o.reduced ?? false}
      awake={o.awake ?? true}
      narrow={o.narrow ?? false}
      rows={o.rows ?? false}
      spoken={0}
      franki={<div data-test-franki="" />}
    />,
  );
}

/** The opening tag of a slot. */
function slot(html: string, name: string): string {
  const m = new RegExp(`<div[^>]*data-demo-slot="${name}"[^>]*>`).exec(html);
  return m === null ? "" : m[0];
}

const SCENES = allScenes(TOY_STATES);
const BRANDED = ["Takeout nights", "$186", "Three quick dinners", "Your list", "$115 less", "Read emails", "Bank · 6 purchases"];

describe("the stage on the server", () => {
  const html = renderToStaticMarkup(<DemoStage step="result" toy="celebrate" onToy={noop} onYes={noop} reduced={false} />);

  it("is a section labelled for the demonstration, with no live region", () => {
    expect(html).toMatch(new RegExp(`^<section aria-label="${LANDING.stage.label}" data-demo-stage=""`));
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("can take focus when a control on it leaves, but is not in the tab order", () => {
    expect(html).toMatch(/^<section [^>]*tabindex="-1"/);
  });

  it("shows Franki asleep and no sample data, whatever the step", () => {
    expect(html).toContain(`aria-label="${AVATAR_LABELS.closed}"`);
    expect(html.match(/role="img"/g)).toHaveLength(1);
    for (const s of BRANDED) expect(html).not.toContain(s);
    expect(html).toContain('data-demo-plate="" data-on="false"');
    expect(html).not.toContain("data-strip=\"\"");
  });

  it("keeps Franki out of any lab stage or screen", () => {
    expect(html).not.toContain("data-stage=");
    expect(html).not.toContain("data-screen");
    expect(html).toContain("data-demo-avatar");
  });
});

describe("the stage, scene by scene", () => {
  it("shows the plate exactly when sample data shows", () => {
    for (const scene of SCENES) {
      const html = view(scene);
      expect(html, scene.step).toContain(`data-demo-plate="" data-on="${scene.plate}"`);
      const hasSample = BRANDED.some((s) => html.includes(s)) || html.includes("data-jar=\"\"") || html.includes('aria-label="What I know"');
      if (hasSample) expect(scene.plate, scene.step).toBe(true);
    }
  });

  it("makes everything inert but the toy and the approval card", () => {
    for (const scene of SCENES) {
      const html = view(scene);
      for (const name of ["line", "strip", "tags", "jar", "lab", "sheet"]) expect(slot(html, name), `${scene.step} ${name}`).toContain("inert");
      const dock = slot(html, "dock");
      if (scene.approval === null) expect(dock, scene.step).toContain("inert");
      else expect(dock, scene.step).not.toContain("inert");
      expect(html.includes('role="radiogroup"'), scene.step).toBe(scene.step === "talk");
    }
  });

  it("puts Yes on the stage only at approve", () => {
    for (const scene of SCENES) {
      const html = view(scene);
      expect(html.includes('data-action="yes"'), scene.step).toBe(scene.step === "approve");
    }
  });

  it("prints the receipt only at forget, from the Lab, and alone on a narrow stage", () => {
    for (const scene of SCENES) expect(view(scene).includes("data-receipt="), `${scene.step} ${scene.beat}`).toBe(scene.receipt);
    const printed = stageFor("forget", "listening", 1);
    expect(view(printed)).toContain("data-lab=\"\"");
    const narrow = view(printed, { narrow: true });
    expect(narrow).toContain("data-receipt=");
    expect(narrow).not.toContain('data-lab=""');
  });

  it("forgets one item from the sheet and leaves the rest", () => {
    const know = view(stageFor("know", "listening"));
    const forget = view(stageFor("forget", "listening", 0));
    const gone = KNOWN_ITEMS.find((i) => i.id === FORGOTTEN_ID)!;
    expect(know).toContain(gone.text);
    expect(forget).not.toContain(gone.text);
    for (const i of KNOWN_ITEMS.filter((k) => k.id !== FORGOTTEN_ID)) expect(forget).toContain(i.text);
  });

  it("knows four things, one of each kind the jar draws, and the jar holds a mote for each", () => {
    expect(KNOWN_ITEMS).toHaveLength(4);
    expect(KNOWN_ITEMS.some((i) => i.id === FORGOTTEN_ID)).toBe(true);
    expect(KNOWN_MOTES.map((m) => m.kind).sort()).toEqual(["guessed", "private", "rule", "told"]);
    expect(KNOWN_MOTES.map((m) => m.id)).toEqual(KNOWN_ITEMS.map((i) => i.id));
  });

  it("lets the sheet scale lower than the other panels from 440 px, and keeps the usual floor narrow", () => {
    const slot = (html: string, name: string) => html.match(new RegExp(`data-demo-slot="${name}"[^>]*>\s*<div[^>]*data-fit-min="([^"]*)"`))?.[1];
    const know = stageFor("know", "listening");
    expect(SHEET_FIT_MIN).toBeLessThan(FIT_MIN);
    expect(slot(view(know), "sheet")).toBe(String(SHEET_FIT_MIN));
    expect(slot(view(know, { narrow: true }), "sheet")).toBe(String(FIT_MIN));
    expect(slot(view(know), "lab")).toBe(String(FIT_MIN));
    expect(slot(view(stageFor("approve", "listening")), "dock")).toBe("1");
    expect(slot(view(stageFor("suggested", "listening", 1)), "dock")).toBe(String(FIT_MIN));
  });

  it("draws the tags beside Franki, joined by the stitched wire at connected", () => {
    expect(view(stageFor("noticed", "listening"))).toContain('data-demo-tag="bank"');
    expect(view(stageFor("noticed", "listening"))).not.toContain("data-demo-wire");
    const c = view(stageFor("connected", "listening"));
    expect(c).toContain('data-demo-tag="calendar"');
    expect(c).toContain("data-demo-wire");
  });

  it("says the line at suggested, and opens the takeout card's rows when there is room", () => {
    const s = view(stageFor("suggested", "listening", 0), { rows: true });
    expect(s).toContain("data-demo-line");
    expect(s).toContain("$34");
    expect(view(stageFor("suggested", "listening", 0))).not.toContain("$34");
  });

  it("shows the hero's fig label once Franki is awake", () => {
    const hero = stageFor("hero", "listening");
    expect(view(hero, { awake: false })).not.toContain("data-demo-fig");
    expect(view(hero, { awake: true })).toContain(LANDING.hero.alive.replace("'", "&#x27;"));
  });

  it("names its layout for the container queries", () => {
    const seen = new Set(SCENES.map((s) => view(s).match(/data-layout="([^"]*)"/)![1]));
    expect([...seen].sort()).toEqual(["equip", "solo", "toy"]);
  });

  it("property: no scene draws a live region", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SCENES), fc.boolean(), fc.boolean(), (scene, narrow, reduced) => {
        const html = view(scene, { narrow, reduced });
        expect(html).not.toContain("aria-live");
      }),
      { numRuns: 40 },
    );
  });
});

describe("fitScale and boxFacts", () => {
  it("scales only what does not fit, never below the floor", () => {
    expect(fitScale(400, 300)).toBe(1);
    expect(fitScale(300, 400)).toBe(0.75);
    expect(fitScale(100, 400)).toBe(FIT_MIN);
    expect(fitScale(100, 400, SHEET_FIT_MIN)).toBe(SHEET_FIT_MIN);
    // The measured know step at 1440 x 900, before the sheet's items went to one row: 1,334 px into 768.
    expect(fitScale(768, 1334, SHEET_FIT_MIN)).toBe(SHEET_FIT_MIN);
    expect(fitScale(768, 1100, SHEET_FIT_MIN)).toBe(0.69);
    expect(fitScale(0, 400)).toBe(1);
    expect(fitScale(400, 0)).toBe(1);
  });

  it("property: the scale is in [min, 1] and the scaled content fits when it can", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 2000, noNaN: true }), fc.double({ min: 1, max: 2000, noNaN: true }), (room, natural) => {
        const s = fitScale(room, natural);
        expect(s).toBeGreaterThanOrEqual(FIT_MIN);
        expect(s).toBeLessThanOrEqual(1);
        if (natural * FIT_MIN <= room) expect(natural * s).toBeLessThanOrEqual(room + 1e-9);
      }),
    );
  });

  it("calls a stage narrow below 440 px and opens rows only on a tall, wide one", () => {
    expect(boxFacts(null)).toEqual({ narrow: false, rows: false });
    expect(boxFacts({ w: NARROW_PX - 1, h: 900 })).toEqual({ narrow: true, rows: false });
    expect(boxFacts({ w: 600, h: ROWS_MIN_HEIGHT_PX })).toEqual({ narrow: false, rows: true });
    expect(boxFacts({ w: 600, h: ROWS_MIN_HEIGHT_PX - 1 })).toEqual({ narrow: false, rows: false });
  });
});

describe("the stage's script steps", () => {
  it("covers every step", () => {
    const steps = new Set<StepId>(SCENES.map((s) => s.step));
    expect(steps.size).toBe(11);
  });
});
