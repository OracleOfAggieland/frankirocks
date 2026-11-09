// Copy check tests (lab-ui-foundation R17.1). The repo scan runs on every `npm test`.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { findBannedCauseWords, findCopyViolations, formatCopyViolations, scanCopy } from "./copy-check.mjs";

const words = (text: string) => findBannedCauseWords(text).map((h: { match: string }) => h.match);

describe("copy check on the repo", () => {
  it("finds no Banned_Cause_Word in components/, ui/ or the Specimens_Page", () => {
    const violations = scanCopy();
    expect(violations, formatCopyViolations(violations)).toEqual([]);
  });
});

describe("findBannedCauseWords examples", () => {
  it("finds each word and phrase in any letter case", () => {
    expect(words("Because you said so")).toEqual(["Because"]);
    expect(words("It CAUSED a fuss")).toEqual(["CAUSED"]);
    expect(words("thanks to the rain")).toEqual(["thanks to"]);
    expect(words("That Led To less spending")).toEqual(["Led To"]);
    expect(words("You won back an hour")).toEqual(["won back"]);
    expect(words("led\nto")).toEqual(["led\nto"]);
  });

  it("passes words that only contain a banned word", () => {
    expect(words("becausey leader causedx thanksto ledto")).toEqual([]);
    expect(words("Mostly on nights with meetings after 6. $115 less.")).toEqual([]);
  });
});

describe("findCopyViolations", () => {
  it("checks string literals and JSX text, not comments", () => {
    const src = [
      "// because this is a comment",
      "/* led to nothing */",
      'const a = "Because of rain";',
      "const b = `won back ${n}`;",
      "const c = <p>Thanks to you</p>;",
      "const ok = <p>Mostly on Thursdays</p>;",
    ].join("\n");
    expect(findCopyViolations(src)).toEqual([
      { line: 3, match: "Because" },
      { line: 4, match: "won back" },
      { line: 5, match: "Thanks to" },
    ]);
  });
});

describe("copy check CLI", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root !== null) rmSync(root, { recursive: true, force: true });
    root = null;
  });
  const tree = (files: Record<string, string>) => {
    root = mkdtempSync(join(tmpdir(), "copy-check-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return spawnSync(process.execPath, [join(REPO_ROOT, "scripts/copy-check.mjs"), root], { encoding: "utf8" });
  };

  it("exits 1 and names the file and line", () => {
    const run = tree({
      "apps/web/src/app/specimens/_fixtures/index.ts": 'export const A = "fine";\nexport const B = "because";\n',
      "apps/web/src/components/X.test.tsx": 'const t = "because";\n',
    });
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe("apps/web/src/app/specimens/_fixtures/index.ts:2: because");
  });

  it("exits 0 on clean copy", () => {
    const run = tree({ "apps/web/src/ui/copy.ts": 'export const A = "Franki is listening";\n' });
    expect(run.status).toBe(0);
  });
});

// Feature: lab-ui-foundation, Property 17: Banned cause words are found
describe("Property 17: Banned cause words are found", () => {
  const BANNED = ["because", "caused", "thanks to", "led to", "won back"];
  const SAFE_WORDS = ["Franki", "listening", "becausey", "leader", "causedx", "thanksto", "ledto", "wonback", "nights", "less", "$115", "meetings", "after", "6", "you", "led", "to", "won", "thanks", "back"];
  // "led to", "thanks to" and "won back" must not form from adjacent safe words.
  const safeText = fc
    .array(fc.constantFrom(...SAFE_WORDS), { minLength: 0, maxLength: 20 })
    .filter((ws) => !/\b(led to|thanks to|won back)\b/i.test(ws.join(" ")));
  const randomCase = (word: string, flips: boolean[]) =>
    [...word].map((ch, i) => (flips[i % flips.length] ? ch.toUpperCase() : ch.toLowerCase())).join("");

  it("reports one inserted banned word in any case, and nothing for safe text", () => {
    fc.assert(
      fc.property(
        safeText,
        fc.nat(),
        fc.constantFrom(...BANNED),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 9 }),
        fc.constantFrom(" ", ". ", ", ", "\n"),
        (ws, at, word, flips, sep) => {
          expect(findBannedCauseWords(ws.join(" "))).toEqual([]);
          const inserted = randomCase(word, flips);
          const index = at % (ws.length + 1);
          const text = [...ws.slice(0, index), inserted, ...ws.slice(index)].join(sep);
          const hits = findBannedCauseWords(text).map((h: { match: string }) => h.match.toLowerCase());
          expect(hits).toContain(word);
        },
      ),
      { numRuns: 200 },
    );
  });
});
