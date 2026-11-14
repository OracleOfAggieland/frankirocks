// Brief 049 part B: the pure parts of a Google connection.
import { describe, expect, it } from "vitest";
import { DEFAULT_DAY_BOUNDS, MAIL_HTML_INPUT_MAX, freeGaps, gmailQuery, isConnectedGoogleRow, mailText, plainText, quotedTerm } from "./index";

const H = 3_600_000;
const DAY = Date.UTC(2026, 10, 16);

describe("isConnectedGoogleRow (ruling 22)", () => {
  it("is a gmail or calendar row with a connector, nothing else", () => {
    expect(isConnectedGoogleRow({ source: "gmail", connectorId: "c" })).toBe(true);
    expect(isConnectedGoogleRow({ source: "calendar", connectorId: "c" })).toBe(true);
    expect(isConnectedGoogleRow({ source: "fixture", connectorId: null })).toBe(false);
    expect(isConnectedGoogleRow({ source: "gmail", connectorId: null })).toBe(false);
    expect(isConnectedGoogleRow({ source: "plaid", connectorId: "c" })).toBe(false);
  });
});

describe("gmailQuery (ruling 23)", () => {
  it("quotes every term so none is an operator, and always leaves out spam, trash, promotions and social", () => {
    expect(gmailQuery({ from: "dana@example.org", words: ["lease"], afterMs: null, beforeMs: null, unread: false })).toBe(
      'from:"dana@example.org" "lease" -in:spam -in:trash -category:promotions -category:social',
    );
    expect(gmailQuery({ from: null, words: ['"', "in:trash", "a) OR (b", "{x}", "label:spam"], afterMs: null, beforeMs: null, unread: false })).toBe(
      '"in trash" "a OR b" "x" "label spam" -in:spam -in:trash -category:promotions -category:social',
    );
  });

  it("takes five words at most, epoch seconds for the dates, and is:unread", () => {
    const q = gmailQuery({ from: null, words: ["a1", "b2", "c3", "d4", "e5", "f6"], afterMs: 1_700_000_000_500, beforeMs: 1_700_086_400_000, unread: true });
    expect(q).toBe('"a1" "b2" "c3" "d4" "e5" after:1700000000 before:1700086400 is:unread -in:spam -in:trash -category:promotions -category:social');
  });

  it("drops a term with nothing left, and cuts a long one", () => {
    expect(quotedTerm('""""')).toBeNull();
    expect(quotedTerm("x".repeat(500))).toBe(`"${"x".repeat(64)}"`);
    expect(quotedTerm("O'Brien  Ünïcode")).toBe(`"O'Brien Ünïcode"`);
  });
});

describe("mailText", () => {
  it("drops scripts, styles, comments and every attribute, keeps link text only, and decodes a few entities", () => {
    const html = '<html><head><title>T</title><style>a{}</style></head><body><!-- hidden --><p>Hi&nbsp;<b>Dana</b></p><div><a href="https://evil.example">click</a> &lt;3 &#x1F600;</div><script>x()</script></body></html>';
    expect(mailText(html, 1000)).toBe("Hi Dana\nclick <3 😀");
  });

  it("drops the rest at an unclosed tag, comment or script, and bounds the output", () => {
    expect(mailText("ok <script>never closed", 100)).toBe("ok");
    expect(mailText("ok <!-- never closed", 100)).toBe("ok");
    expect(mailText("ok <b", 100)).toBe("ok");
    expect(mailText("a".repeat(500), 10)).toBe("a".repeat(10));
  });

  it("is linear on hostile shapes", () => {
    const big = "<".repeat(MAIL_HTML_INPUT_MAX);
    const t0 = performance.now();
    mailText(big, 100);
    mailText("<script>".repeat(MAIL_HTML_INPUT_MAX / 8), 100);
    mailText("<a ".repeat(MAIL_HTML_INPUT_MAX / 3) + ">", 100);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });

  it("plainText removes control and direction characters", () => {
    expect(plainText("a‮b\u0007c\r\n\r\n\r\nd", 100)).toBe("a b c\n\nd");
  });
});

describe("freeGaps (ruling 25)", () => {
  const ev = (s: number, e: number, over: Partial<{ allDay: boolean; free: boolean }> = {}) => ({ startMs: DAY + s * H, endMs: DAY + e * H, allDay: false, free: false, ...over });

  it("finds the gaps between busy events inside the day bounds", () => {
    expect(freeGaps([ev(10, 11), ev(10.5, 12), ev(14, 15)], { fromMs: DAY, toMs: DAY + 24 * H }, "UTC", DEFAULT_DAY_BOUNDS, 60)).toEqual([
      { startMs: DAY + 9 * H, endMs: DAY + 10 * H },
      { startMs: DAY + 12 * H, endMs: DAY + 14 * H },
      { startMs: DAY + 15 * H, endMs: DAY + 18 * H },
    ]);
  });

  it("all-day and free events don't block; a gap shorter than asked is left out; the window clips", () => {
    // Review D10: an all-day event blocks unless it is free (transparent); this one is.
    expect(freeGaps([ev(0, 24, { allDay: true, free: true }), ev(9, 17, { free: true }), ev(9.5, 17.5)], { fromMs: DAY + 9 * H, toMs: DAY + 17.75 * H }, "UTC", DEFAULT_DAY_BOUNDS, 30)).toEqual([
      { startMs: DAY + 9 * H, endMs: DAY + 9.5 * H },
    ]);
  });

  it("reads the day bounds in the calendar's zone, and refuses a window over 14 days or a bad length", () => {
    const chicago = freeGaps([], { fromMs: DAY, toMs: DAY + 24 * H }, "America/Chicago", DEFAULT_DAY_BOUNDS, 60);
    expect(chicago).toEqual([{ startMs: DAY + 15 * H, endMs: DAY + 24 * H }]);
    expect(freeGaps([], { fromMs: DAY, toMs: DAY + 15 * 24 * H }, "UTC", DEFAULT_DAY_BOUNDS, 60)).toEqual([]);
    expect(freeGaps([], { fromMs: DAY, toMs: DAY + 24 * H }, "UTC", DEFAULT_DAY_BOUNDS, 0)).toEqual([]);
  });
});
