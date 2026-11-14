// Brief 049 part B review fixes D8, D9, D10 and D12, in the pure layer: case-folding that shifts offsets, invisible
// characters, links that survive the tag pass, a cut that splits a character, all-day busy time, and a query with a
// time that isn't a whole number.
import { describe, expect, it } from "vitest";
import { DEFAULT_DAY_BOUNDS, LINK_MARKER, cutAt, freeGaps, freeTimeAsk, gmailQuery, linkless, mailQueryValid, mailTextOf, plainText, visibleText } from "./index";

const DAY = Date.UTC(2026, 10, 16);
const H = 3_600_000;

describe("D9: HTML to text", () => {
  it("drops script and style contents even after a character whose lower case is longer", () => {
    const html = `${"İ".repeat(40)}<SCRIPT>steal()</SCRIPT><Style>p{x:1}</STYLE>ok`;
    const out = mailTextOf(html, 1000).text;
    expect(out).not.toContain("steal");
    expect(out).not.toContain("x:1");
    expect(out.endsWith("ok")).toBe(true);
  });

  it("turns invisible and format characters in body text into spaces", () => {
    const hidden = "a\u{E0049}\u{E0067}b؜c⁠d­e f g‮h⁦i​j﻿k";
    const out = plainText(hidden, 1000);
    expect(out).toBe("a b c d e f g h i j k");
  });

  it("visibleText strips the same set from a one-line field", () => {
    expect(visibleText("Pay\u{E0041}‮ now please")).toBe("Pay now please");
  });

  it("replaces every URL-like token with the link marker, in markup and in plain text", () => {
    // The tag ends at the first ">", so the attribute's tail is text: its URL is replaced, up to the quote.
    expect(mailTextOf('<a href="x>https://evil.example/login">Sign in</a>', 1000).text).toBe(`${LINK_MARKER}">Sign in`);
    expect(plainText("Go to https://evil.example/a?b=c now, or www.evil.example, or evil.example/login, mailto:x@y.z", 1000)).toBe(`Go to ${LINK_MARKER} now, or ${LINK_MARKER} or ${LINK_MARKER} ${LINK_MARKER}`);
    expect(linkless("(see http://a.b/c)")).toBe(`(see ${LINK_MARKER}`);
    expect(linkless("dana@example.org wrote on 3.5.2026")).toBe("dana@example.org wrote on 3.5.2026");
  });
});

describe("D8: a cut never splits a character, and says it cut", () => {
  it("cutAt keeps a surrogate pair whole", () => {
    const s = `ab${"\u{1F600}"}cd`;
    expect(cutAt(s, 3)).toBe("ab");
    expect(cutAt(s, 4)).toBe(`ab${"\u{1F600}"}`);
    expect(plainText(s, 3)).toBe("ab");
  });

  it("HTML cut inside an open tag is marked as dropped", () => {
    expect(mailTextOf("<p>hello</p><a href='never closed", 1000)).toEqual({ text: "hello", dropped: true });
    expect(mailTextOf("<p>hello</p>", 1000)).toEqual({ text: "hello", dropped: false });
    expect(mailTextOf("<p>hello</p><!-- open", 1000).dropped).toBe(true);
    expect(mailTextOf("<script>never closed", 1000).dropped).toBe(true);
  });
});

describe("D10: free time", () => {
  const ev = (s: number, e: number, over: Partial<{ allDay: boolean; free: boolean }> = {}) => ({ startMs: DAY + s * H, endMs: DAY + e * H, allDay: false, free: false, ...over });

  it("an opaque all-day event blocks its day; a free one doesn't", () => {
    expect(freeGaps([ev(0, 24, { allDay: true })], { fromMs: DAY, toMs: DAY + 24 * H }, "UTC", DEFAULT_DAY_BOUNDS, 30)).toEqual([]);
    expect(freeGaps([ev(0, 24, { allDay: true, free: true })], { fromMs: DAY, toMs: DAY + 24 * H }, "UTC", DEFAULT_DAY_BOUNDS, 30)).toEqual([{ startMs: DAY + 9 * H, endMs: DAY + 18 * H }]);
  });

  it("freeTimeAsk names a length that can't fit the day as invalid", () => {
    expect(freeTimeAsk(60, DEFAULT_DAY_BOUNDS)).toBe("ok");
    expect(freeTimeAsk(9 * 60, DEFAULT_DAY_BOUNDS)).toBe("ok");
    for (const m of [0, -5, 9 * 60 + 1, 1.5, Number.NaN]) expect(freeTimeAsk(m, DEFAULT_DAY_BOUNDS)).toBe("invalid");
    expect(freeTimeAsk(30, { startMinute: 600, endMinute: 540 })).toBe("invalid");
  });
});

describe("D12: a time that isn't a whole number is refused", () => {
  const q = { from: null, words: ["lease"], afterMs: null, beforeMs: null, unread: false };
  it("mailQueryValid", () => {
    expect(mailQueryValid(q)).toBe(true);
    expect(mailQueryValid({ ...q, afterMs: 1.5 })).toBe(false);
    expect(mailQueryValid({ ...q, beforeMs: -1 })).toBe(false);
    expect(mailQueryValid({ ...q, afterMs: Number.NaN })).toBe(false);
    expect(() => gmailQuery({ ...q, afterMs: 1.5 })).toThrow(RangeError);
  });
});
