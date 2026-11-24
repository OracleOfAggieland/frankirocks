/**
 * Taste (brief 054 design, correctness property 8; R25.1, R25.2). 1,000 runs.
 *   FOR ALL string fields of the Kisses fixture (turn text, mail names, addresses, subjects and bodies, thread
 *   names, calendar titles, bank merchants, the demo profile, and every packet a line carries), no word of the
 *   Denied_List appears, compared after NFKC and case folding, on word boundaries;
 *   AND FOR ALL such fields f and Denied_List words w, f with w put in on a word boundary is flagged, so the scan
 *   above could have failed.
 * The scanner itself is checked against generated lists by property 9. This file applies the real list to the real
 * persona.
 *
 * The Denied_List is written folded with punctuation as a space ("chick fil a"), so each field is read twice: as
 * written, and with every run of punctuation as one space.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KISSES } from "../seed/kisses";
import { DENIED_WORDS } from "../testing/denied-words";
import { deniedWordsIn } from "./taste-scanner";

const RUNS = { numRuns: 1000 };

/** Every string anywhere in the fixture, with the path that reached it, so a failure names the field. */
function stringsOf(value: unknown, path: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => stringsOf(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) stringsOf(v, `${path}.${k}`, out);
  return out;
}

/** The second reading: every run of characters that are not letters, marks or digits becomes one space. */
const spaced = (s: string): string => s.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ");

const flagged = (text: string): string[] => [...new Set([...deniedWordsIn(text, DENIED_WORDS), ...deniedWordsIn(spaced(text), DENIED_WORDS)])];

const FIELDS = stringsOf(KISSES, "KISSES");

describe("taste: the Kisses persona names nothing real", () => {
  it("has fields to read and a list to read them against", () => {
    expect(FIELDS.length).toBeGreaterThan(300);
    expect(DENIED_WORDS.length).toBeGreaterThan(100);
  });

  it("holds no denied word in any string field", () => {
    const hits = FIELDS.flatMap((f) => flagged(f.text).map((w) => `${f.path}: "${w}"`));
    expect(hits).toEqual([]);
  });

  it("would flag any field that gained a denied word", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FIELDS),
        fc.constantFrom(...DENIED_WORDS),
        fc.boolean(),
        fc.constantFrom<(w: string) => string>(
          (w) => w,
          (w) => w.toUpperCase(),
          (w) => w.replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
        ),
        (field, word, atEnd, casing) => {
          const text = atEnd ? `${field.text} ${casing(word)}` : `${casing(word)}, ${field.text}`;
          expect(flagged(text)).toContain(word);
        },
      ),
      RUNS,
    );
  });
});
