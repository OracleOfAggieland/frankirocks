import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./Wordmark";

const CSS = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");

describe("Wordmark", () => {
  it("reads Franki in the header", () => {
    expect(renderToStaticMarkup(<Wordmark variant="header" />)).toContain(">Franki<");
  });

  it("reads FRANKIROCKS signed out, with K, I, R and O lit", () => {
    const html = renderToStaticMarkup(<Wordmark variant="signedOut" />);
    expect(html).toContain('aria-label="FRANKIROCKS"');
    const lit = [...html.matchAll(/data-lit=""[^>]*>(.)</g)].map((m) => m[1]);
    expect(lit).toEqual(["K", "I", "R", "O"]);
  });

  it("lights them by a one-iteration animation and only fades under reduced motion", () => {
    const rules = [...CSS.matchAll(/\.franki-kiro\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const r of rules.filter((r) => r.includes("animation"))) expect(r).toMatch(/\b1 both\b/);
    expect(CSS).toMatch(/\[data-reduced="true"\] \.franki-kiro \{\s*animation: franki-kiro-fade/);
    const fade = /@keyframes franki-kiro-fade \{([^@]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(fade).not.toContain("transform");
  });
});
