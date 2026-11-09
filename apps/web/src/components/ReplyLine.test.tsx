import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplyLine } from "./ReplyLine";

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
