import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMPOSITE_INDEXES } from "./indexes";

const declared = JSON.parse(readFileSync(new URL("../../../../firestore.indexes.json", import.meta.url), "utf8")) as {
  indexes: { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order: string }[] }[];
  fieldOverrides: unknown[];
};

describe("firestore.indexes.json (R7.8, KS08)", () => {
  it("declares the composite indexes used by the Store_Port", () => {
    expect(declared.indexes).toEqual(
      COMPOSITE_INDEXES.map((i) => ({ collectionGroup: i.collection, queryScope: "COLLECTION", fields: i.fields })),
    );
    expect(COMPOSITE_INDEXES.map((i) => i.query)).toEqual(["Q03", "Q13", "Q17", "Q18", "Q33", "sessionPhoneCalls", "sessionPhoneActivity"]);
  });

  it("has no composite index for Q14 (turns by seq) or Q28 (by document ID)", () => {
    expect(declared.indexes.some((i) => i.collectionGroup === "turns")).toBe(false);
    expect(declared.indexes.some((i) => i.fields.some((f) => f.fieldPath === "__name__"))).toBe(false);
  });
});
