import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { SPRING } from "../../ui/motion";
import { Materialize, materializeTransition, materializeVariants } from "./Materialize";

describe("Materialize", () => {
  it("rises 12 px, fades and unblurs on enter; rises 8 px, fades and blurs on exit", () => {
    const v = materializeVariants(false);
    expect(v.hidden).toEqual({ opacity: 0, y: 12, filter: "blur(6px)" });
    expect(v.shown).toEqual({ opacity: 1, y: 0, filter: "blur(0px)" });
    expect(v.gone).toEqual({ opacity: 0, y: -8, filter: "blur(6px)" });
    expect(materializeTransition(false)).toMatchObject({ y: { type: "spring", ...SPRING.settle } });
  });

  it("is a plain opacity fade under Reduced_Motion", () => {
    const v = materializeVariants(true);
    for (const key of ["hidden", "shown", "gone"]) expect(Object.keys(v[key] as object)).toEqual(["opacity"]);
    expect(materializeTransition(true)).toEqual({ duration: 0.32, ease: [0.22, 1, 0.36, 1] });
  });

  it("renders its children while shown and nothing when hidden", () => {
    const shown = renderToStaticMarkup(
      <ReducedMotionOverride reduced>
        <Materialize show>hello</Materialize>
      </ReducedMotionOverride>,
    );
    expect(shown).toContain("hello");
    expect(shown).toContain('data-materialize="fade"');
    expect(renderToStaticMarkup(<Materialize show={false}>hello</Materialize>)).toBe("");
  });
});
