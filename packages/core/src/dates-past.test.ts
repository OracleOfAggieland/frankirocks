/** Brief 049 part C, review fix E2: the backward resolver for mail, table-tested. */
import { describe, expect, it } from "vitest";
import { civilDateAt, resolvePast } from "./dates";

const ZONE = "America/Chicago";
// Saturday, Nov 14, 2026, 12:00 in Chicago.
const NOW = Date.UTC(2026, 10, 14, 18);
const days = (phrase: string) => {
  const r = resolvePast(phrase, NOW, ZONE);
  return r === null ? null : [civilDateAt(r.fromMs, ZONE), civilDateAt(r.toMs - 1, ZONE)];
};

describe("resolvePast", () => {
  const table: [string, [string, string] | null][] = [
    ["today", ["2026-11-14", "2026-11-14"]],
    ["yesterday", ["2026-11-13", "2026-11-13"]],
    ["last Tuesday", ["2026-11-10", "2026-11-10"]],
    ["on Tuesday", ["2026-11-10", "2026-11-10"]],
    ["Tuesday", ["2026-11-10", "2026-11-10"]],
    ["Saturday", ["2026-11-14", "2026-11-14"]],
    ["last Saturday", ["2026-11-07", "2026-11-07"]],
    ["this week", ["2026-11-09", "2026-11-14"]],
    ["last week", ["2026-11-02", "2026-11-08"]],
    ["3 days ago", ["2026-11-11", "2026-11-11"]],
    ["two days ago", ["2026-11-12", "2026-11-12"]],
    ["in October", ["2026-10-01", "2026-10-31"]],
    ["November", ["2026-11-01", "2026-11-14"]],
    ["December", ["2025-12-01", "2025-12-31"]],
    ["next Friday", null],
    ["tomorrow", null],
    ["sometime soonish", null],
    ["", null],
  ];
  for (const [phrase, want] of table) it(JSON.stringify(phrase), () => expect(days(phrase)).toEqual(want));

  it("never ends after now", () => {
    for (const p of ["today", "this week", "November"]) expect(resolvePast(p, NOW, ZONE)!.toMs).toBeLessThanOrEqual(NOW + 1);
  });
});
