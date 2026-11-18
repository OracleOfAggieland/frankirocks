import { type Card as WireCard, validate, Card as CardSchema } from "@franki/core";
import { testId } from "@franki/core/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Card } from "../components/surfaces/Card";
import { errandCardProps, NO_ERRANDS_SHOWN } from "./errands/errand-view";

it("puts each web finding and its own clickable citations together on the visible card", () => {
  const findings = ["Lake Stage", "River Hall"].map((title, i): WireCard => ({
    kind: "source", id: testId(title), title: "Web search", sens: "S2", lines: [`${title} has live music.`],
    sources: [], citations: [{ title: `${title} calendar`, url: `https://example.org/events/${i}` }],
  }));
  const cards = errandCardProps({ ...NO_ERRANDS_SHOWN, cards: findings });
  expect(cards).toHaveLength(1);
  const html = renderToStaticMarkup(<Card {...cards[0]!} />);
  for (const [i, title] of ["Lake Stage", "River Hall"].entries()) {
    const line = html.slice(html.indexOf(`${title} has live music.`)).split("</li>")[0];
    expect(line).toContain(`href="https://example.org/events/${i}"`);
    expect(line).toContain(`>${title} calendar</a>`);
  }
  for (const url of ["javascript:alert(1)", "https://example.org@evil.test/unsafe", "//example.org"]) {
    expect(validate(CardSchema, { ...findings[0], citations: [{ url, title: "link" }] }).ok).toBe(false);
  }
});
