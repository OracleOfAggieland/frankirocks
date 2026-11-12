import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MainScreen } from "./MainScreen";

const base = { signedIn: true, auth: null, soundToggle: null, stage: null, controls: null, typed: null, live: null, reduced: true, paused: false };

describe("MainScreen memory slots (brief 020)", () => {
  it("renders each surface in its slot, and empty slots with nothing given", () => {
    const filled = renderToStaticMarkup(<MainScreen {...base} jar={<i data-x="jar" />} lab={<i data-x="lab" />} strip={<i data-x="strip" />} chips={<i data-x="chips" />} />);
    expect(filled).toMatch(/data-slot="jar"><i data-x="jar"><\/i>/);
    expect(filled).toMatch(/data-slot="lab"><i data-x="lab"><\/i>/);
    expect(filled).toMatch(/data-area="strip"[^>]*><i data-x="strip"><\/i>/);
    expect(filled).toMatch(/data-area="chips"[^>]*><i data-x="chips"><\/i>/);
    const empty = renderToStaticMarkup(<MainScreen {...base} />);
    expect(empty).toMatch(/data-slot="jar"><\/div>/);
    expect(empty).toMatch(/data-slot="lab"><\/div>/);
  });
});
