import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// R8.1, checked without the emulator: exactly one allow statement, deny-all on the recursive path.
describe("firestore.rules", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  const code = rules.replace(/\/\/.*$/gm, "");

  it("has exactly one allow statement: read and write if false on /{document=**}", () => {
    expect(code.match(/\ballow\b/g)).toHaveLength(1);
    expect(code).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;\s*\}/);
  });
});
