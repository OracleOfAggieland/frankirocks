import { describe, expect, it } from "vitest";
import { CANDIDATE_P, STRONG_P } from "./classes";
import { changesWhatIsSaid, routeFires } from "./route";

describe("routeFires: both nets, or one very sure net (review of the live run, item 5)", () => {
  it("a candidate fires when the judge's value is not O, or at STRONG_P alone", () => {
    expect([CANDIDATE_P, STRONG_P]).toEqual([0.2, 0.8]);
    for (const judge of ["H", "U", "timeout", "error", "typed"] as const) {
      expect(routeFires("forget", 0.2, judge), judge).toBe(true);
      expect(routeFires("forget", 0.19, judge), judge).toBe(false);
    }
    expect(routeFires("forget", 0.79, "O")).toBe(false);
    expect(routeFires("forget", 0.8, "O")).toBe(true);
    expect(routeFires("company", 0.92, "O")).toBe(true);
    expect(routeFires("alone", 0.41, "O")).toBe(false);
  });

  it("crisis is exempt: a retained candidate fires whatever the judge said", () => {
    expect(routeFires("crisis", 0.2, "O")).toBe(true);
    expect(routeFires("crisis", 0.19, "H")).toBe(false);
  });
});

describe("changesWhatIsSaid", () => {
  const hit = (chosen: "forget" | "rushed" | "company", p: number, extra: Record<string, number> = {}) => ({ chosen, candidates: [chosen, ...Object.keys(extra)] as never[], candidateP: { [chosen]: p, ...extra } });
  it("follows routeFires for the classes whose route changes what is said", () => {
    expect(changesWhatIsSaid(hit("forget", 0.5), "O", "A")).toBe(false);
    expect(changesWhatIsSaid(hit("forget", 0.5), "timeout", "A")).toBe(true);
    expect(changesWhatIsSaid(hit("rushed", 0.99), "H", "A")).toBe(false);
    expect(changesWhatIsSaid(hit("company", 0.9), "H", "A")).toBe(false);
    expect(changesWhatIsSaid(hit("company", 0.9), "H", "B")).toBe(true);
    expect(changesWhatIsSaid(hit("rushed", 0.3, { crisis: 0.2 }), "O", "A")).toBe(true);
  });
});