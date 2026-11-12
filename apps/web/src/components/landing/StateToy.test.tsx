import fc from "fast-check";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { TOY_STATES } from "../../ui/landing/steps";
import { FOCUS, TARGET } from "../surfaces/classes";
import { StateToy, toyKeyStep } from "./StateToy";

const chips = (html: string) => [...html.matchAll(/<button ([^>]*)>/g)].map((m) => m[1]!);

describe("the state toy", () => {
  it("is a labelled radio group of the four states, in order", () => {
    const html = renderToStaticMarkup(<StateToy value="thinking" onChange={() => {}} />);
    expect(html).toContain(`role="radiogroup" aria-label="${LANDING.stage.toyLabel}"`);
    const list = chips(html);
    expect(list.map((a) => /data-toy="([^"]*)"/.exec(a)![1])).toEqual([...TOY_STATES]);
    for (const s of TOY_STATES) expect(html).toContain(`${LANDING.stage.toy[s]}</button>`);
  });

  it("checks only the pick, puts only the pick in the tab order, and gives every chip a target and a focus ring", () => {
    const list = chips(renderToStaticMarkup(<StateToy value="muted" onChange={() => {}} />));
    for (const a of list) {
      const on = a.includes('data-toy="muted"');
      expect(a).toContain('role="radio"');
      expect(a).toContain(`aria-checked="${on}"`);
      expect(a).toContain(`tabindex="${on ? 0 : -1}"`);
      for (const c of `${TARGET} ${FOCUS}`.split(" ")) expect(a).toContain(c);
      expect(a).toContain(on ? "mat-brass" : "mat-glass");
    }
  });

  it("draws each glyph as decoration", () => {
    const html = renderToStaticMarkup(<StateToy value="listening" onChange={() => {}} />);
    expect(html.match(/<svg aria-hidden="true" focusable="false"/g)).toHaveLength(TOY_STATES.length);
  });

  it("moves the pick with the arrow keys, Home and End, wrapping round", () => {
    expect(toyKeyStep("listening", "ArrowRight")).toBe("thinking");
    expect(toyKeyStep("listening", "ArrowLeft")).toBe("celebrate");
    expect(toyKeyStep("celebrate", "ArrowDown")).toBe("listening");
    expect(toyKeyStep("thinking", "Home")).toBe("listening");
    expect(toyKeyStep("thinking", "End")).toBe("celebrate");
    expect(toyKeyStep("thinking", "Enter")).toBeNull();
  });

  it("property: a key pressed with Alt, Ctrl or Meta is left to the browser", () => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
    fc.assert(
      fc.property(fc.constantFrom(...TOY_STATES), fc.constantFrom(...keys), fc.constantFrom("altKey", "ctrlKey", "metaKey"), (s, key, mod) => {
        expect(toyKeyStep(s, key, { [mod]: true })).toBeNull();
        expect(toyKeyStep(s, key, { altKey: false, ctrlKey: false, metaKey: false })).not.toBeNull();
      }),
    );
  });

  it("property: right then left returns to where it was", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TOY_STATES), (s) => {
        expect(toyKeyStep(toyKeyStep(s, "ArrowRight")!, "ArrowLeft")).toBe(s);
        expect(toyKeyStep(toyKeyStep(s, "ArrowUp")!, "ArrowDown")).toBe(s);
      }),
    );
  });
});
