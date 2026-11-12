import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReplyEntry } from "../ui/turn-copies";
import { ReplyLine, replyKey } from "./ReplyLine";

describe("ReplyLine", () => {
  it("shows only the latest reply in a polite region", () => {
    const html = renderToStaticMarkup(
      <ReplyLine
        entries={[
          { role: "user", text: "one" },
          { role: "franki", text: "First reply." },
          { role: "user", text: "two" },
          { role: "franki", text: "Second reply." },
        ]}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Second reply.");
    expect(html).not.toContain("First reply.");
    expect(html).not.toContain("two");
  });

  it("escapes stored markup", () => {
    const html = renderToStaticMarkup(<ReplyLine entries={[{ role: "user", text: "x" }, { role: "franki", text: "<img src=x onerror=alert(1)>" }]} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("ReplyLine looks (brief 015)", () => {
  it("a new turn with the same reply words gets a new capsule key, so it materializes and is announced again", () => {
    const first: ReplyEntry[] = [
      { role: "user", text: "add milk" },
      { role: "franki", text: "Got it." },
    ];
    const second: ReplyEntry[] = [...first, { role: "user", text: "add eggs" }, { role: "franki", text: "Got it." }];
    expect(renderToStaticMarkup(<ReplyLine entries={first} />)).toContain("Got it.");
    expect(renderToStaticMarkup(<ReplyLine entries={second} />)).toContain("Got it.");
    expect(replyKey(second)).not.toBe(replyKey(first));
    // The key holds while the turn's entries stay the same.
    expect(replyKey([...first])).toBe(replyKey(first));
  });

  it("one glass capsule with a small ghost glyph, only when there is a reply; the polite region stays", () => {
    const none = renderToStaticMarkup(<ReplyLine entries={[{ role: "user", text: "x" }]} />);
    expect(none).toContain('aria-live="polite"');
    expect(none).not.toContain("data-reply-capsule");
    const one = renderToStaticMarkup(<ReplyLine entries={[{ role: "user", text: "x" }, { role: "franki", text: "Hello." }]} />);
    expect(one.match(/data-reply-capsule=""/g)).toHaveLength(1);
    expect(one).toMatch(/data-reply-capsule="" class="[^"]*\bmat-glass\b[^"]*\bfranki-materialize\b/);
    expect(one.indexOf("franki-reply-ghost")).toBeLessThan(one.indexOf("Hello."));
    const css = readFileSync(join(__dirname, "screen/screen.css"), "utf8");
    expect(css).toMatch(/\.franki-reply-ghost \{[^}]*background-color: var\(--color-ghost\)[^}]*\bmask: url\(/);
  });
});
