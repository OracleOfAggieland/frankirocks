// Kiroween Demo, property 18 (R14.1): the phone is not offered on a call. For any capabilities (`specialists` absent
// or any catalog, `errandsReady`, `webSearchStatus`):
//   with `phoneOff` true, `callTools` holds no `make_phone_call`, no `read_phone_result` (plain or the activity
//   variant), and a `delegate_specialist` that names no phone; every other tool is today's, in today's order;
//   with `phoneOff` absent or false, the list is exactly today's.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type SpecialistCatalog, SPECIALIST_STATES, delegationTool } from "../specialists";
import { WEB_SEARCH_STATES } from "../search";
import { callTools } from "./machine";

type Caps = Parameters<typeof callTools>[0];

const stateArb = fc.constantFrom(...SPECIALIST_STATES);
const catalogArb: fc.Arbitrary<SpecialistCatalog> = fc.record({ phone: stateArb, mail: stateArb, calendar: stateArb });
const capsArb: fc.Arbitrary<Caps> = fc.record({
  errandsReady: fc.boolean(),
  specialists: fc.option(catalogArb, { nil: undefined, freq: 3 }).chain((c) => (c === undefined ? fc.constantFrom<SpecialistCatalog | null | undefined>(undefined, null) : fc.constant(c))),
  webSearchStatus: fc.option(fc.constantFrom(...WEB_SEARCH_STATES), { nil: null }),
});

const PHONE_NAMES = new Set(["make_phone_call", "read_phone_result"]);

/** Today's list with the phone taken out: the phone tools dropped, and the delegation tool rebuilt with no phone. */
function withoutPhone(caps: Caps) {
  return callTools(caps).flatMap((t) => {
    if (PHONE_NAMES.has(t.name)) return [];
    if (t.name === "delegate_specialist" && caps.specialists) {
      const rebuilt = delegationTool({ ...caps.specialists, phone: "unavailable" });
      return rebuilt === null ? [] : [rebuilt];
    }
    return [t];
  });
}

describe("the phone is not offered on a call (Kiroween Demo property 18)", () => {
  it("property: phoneOff drops every phone tool and nothing else; absent or false is today's list", () => {
    fc.assert(
      fc.property(capsArb, (caps) => {
        const today = callTools(caps);
        expect(callTools({ ...caps, phoneOff: false })).toEqual(today);

        const off = callTools({ ...caps, phoneOff: true });
        expect(off.some((t) => PHONE_NAMES.has(t.name))).toBe(false);
        for (const t of off) {
          if (t.name !== "delegate_specialist") continue;
          expect((t.parameters.properties.specialist.enum as readonly string[]).includes("phone")).toBe(false);
          expect(t.description).not.toContain("phone:");
        }
        expect(off).toEqual(withoutPhone(caps));
      }),
      { numRuns: 1_000 },
    );
  });

  it("the flat list on a new call, before any state poll, has no phone tool", () => {
    const today = callTools({ errandsReady: false }).map((t) => t.name);
    expect(today).toContain("make_phone_call");
    const names = callTools({ errandsReady: false, phoneOff: true }).map((t) => t.name);
    expect(names).toEqual(today.filter((n) => n !== "make_phone_call"));
    expect(names).toContain("read_money");
  });
});
