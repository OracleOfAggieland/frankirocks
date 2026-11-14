import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LANDING } from "../../ui/copy-landing";
import { Build } from "./Build";

const CSS = readFileSync(join(__dirname, "lower.css"), "utf8");
const html = () => renderToStaticMarkup(<Build />);

describe("Build", () => {
  it("is the #build section, titled by its h2, with no h1", () => {
    const out = html();
    expect(out).toMatch(/<section id="build" aria-labelledby="build-title"/);
    // The title reads as written, with the name Kiro as a link to Kiro's site in a new tab.
    const title = /<h2 id="build-title"[^>]*>([\s\S]*?)<\/h2>/.exec(out)?.[1] ?? "";
    expect(title.replace(/<[^>]*>/g, "")).toBe(LANDING.sections.build.title);
    expect(title).toMatch(/<a href="https:\/\/kiro\.dev\/" target="_blank" rel="noopener noreferrer"[^>]*>Kiro<\/a>/);
    expect(out).toContain(LANDING.sections.build.body);
    expect(out).toContain(LANDING.sections.build.eyebrow);
    expect(out).not.toContain("<h1");
  });

  it("sets FRANKIROCKS as a paragraph named as one image, with K, I, R and O lit", () => {
    const out = html();
    expect(out).toMatch(/<p role="img" aria-label="FRANKIROCKS"[^>]*data-kiro-word=""/);
    const word = out.split("data-kiro-word")[1].split("</p>")[0];
    expect(word.match(/<span aria-hidden="true"/g)).toHaveLength("FRANKIROCKS".length);
    const lit = [...out.matchAll(/data-lit="" class="franki-kiro"[^>]*>(.)</g)].map((m) => m[1]);
    expect(lit).toEqual(["K", "I", "R", "O"]);
    expect(out).toMatch(/data-kiro-word=""[^>]*class="[^"]*\bwhitespace-nowrap\b[^"]*\bfont-mono\b/);
  });

  it("comes before the title, and the anatomy after the body", () => {
    const out = html();
    const word = out.indexOf("data-kiro-word");
    const title = out.indexOf('id="build-title"');
    const fig = out.indexOf("data-anatomy");
    expect(word).toBeGreaterThan(-1);
    expect(word).toBeLessThan(title);
    expect(title).toBeLessThan(fig);
  });

  it("is not marked seen on the server", () => {
    expect(html()).not.toMatch(/data-kiro-word=""[^>]*data-seen=""/);
  });

  it("holds K-I-R-O unlit only while scripting runs and the word is unseen", () => {
    expect(CSS).toMatch(/@media \(scripting: enabled\) \{\s*\[data-kiro-word\]:not\(\[data-seen\]\) \.franki-kiro \{\s*animation-play-state: paused;/);
  });

  it("scales the word with its container so 10.2 em of letters always fits", () => {
    const size = /\.lower-word \{\s*font-size: min\(var\(--text-hero\), ([\d.]+)cqw\)/.exec(CSS);
    expect(size).not.toBeNull();
    expect(Number(size![1]) * 10.2).toBeLessThanOrEqual(100);
    expect(html()).toMatch(/class="@container w-full"/);
  });
});
