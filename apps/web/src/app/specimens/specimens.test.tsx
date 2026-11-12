import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LOOK_NAMES } from "../../ui/avatar/look";
import { EVENTS, SPECIMENS_SENTINEL_9c41, STATES } from "./_fixtures";
import SpecimensPage from "./page.dev";

const html = renderToStaticMarkup(<SpecimensPage />);

/** Each avatar specimen tile with its attributes and the look its Avatar shows. */
const tiles = [...html.matchAll(/<figure ([^>]*data-specimen="avatar"[^>]*)>([\s\S]*?)<\/figure>/g)].map((m) => {
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1];
  return {
    state: attr("data-state"),
    event: attr("data-event"),
    ghost: attr("data-specimen-ghost"),
    reduced: attr("data-specimen-reduced"),
    look: /data-look="([^"]+)"/.exec(m[2])?.[1],
    avatarReduced: /data-reduced="([^"]+)"/.exec(m[2])?.[1],
  };
});

describe("Specimens_Page (R20.1, R20.2)", () => {
  it("shows every Look_Name with Reduced_Motion off and on", () => {
    for (const reduced of ["false", "true"]) {
      const looks = new Set(tiles.filter((t) => t.reduced === reduced).map((t) => t.look));
      for (const name of LOOK_NAMES) expect(looks.has(name), `${name} reduced=${reduced}`).toBe(true);
    }
    for (const t of tiles) expect(t.avatarReduced).toBe(t.reduced);
  });

  it("shows every Avatar_Event over every state, in both motion settings", () => {
    for (const reduced of ["false", "true"]) {
      for (const state of STATES) {
        for (const event of EVENTS) {
          const found = tiles.filter((t) => t.reduced === reduced && t.state === state && t.event === (event ?? "none") && t.ghost === "false");
          expect(found.length, `${state} ${event} ${reduced}`).toBeGreaterThanOrEqual(1);
          expect(found[0].look).toBeDefined();
        }
      }
    }
  });

  it("shows Ghost_Mode over each state, in both motion settings", () => {
    for (const reduced of ["false", "true"]) {
      for (const state of STATES) {
        expect(tiles.some((t) => t.reduced === reduced && t.state === state && t.ghost === "true"), `${state} ${reduced}`).toBe(true);
      }
    }
    expect(html).toContain('data-ghost="true"');
  });

  it("shows every Surface kind and state", () => {
    for (const kind of ["source", "approval", "food", "ask", "read"]) expect(html).toContain(`data-card="${kind}"`);
    for (const fill of [0, 1, 2, 3, 4, 5]) expect(html).toContain(`data-strip="" data-filled="${fill}"`);
    expect(html).toContain('data-specimen="strip-375"');
    for (const marker of ["data-dock=", "data-jar=", "data-sheet=", "data-lab=", "data-receipt=", "data-time-badge=", "data-chips=", 'data-captions="on"', 'data-captions="off"', 'data-wordmark="header"', 'data-wordmark="signedOut"']) {
      expect(html, marker).toContain(marker);
    }
    for (const kind of ["told", "guessed", "rule", "private"]) expect(html).toContain(`data-mote="${kind}"`);
    expect(html).toContain(">—<");
    expect(html).toContain('data-form="start"');
    expect(html).toContain('data-form="hangup"');
    expect(html).toContain('data-phase="before forget"');
    expect(html).toContain('data-phase="after forget"');
  });

  it("shows the Main_Screen without and with a Card (Brief 004 item 1)", () => {
    expect(html).toContain('data-specimen-screen="no-card"');
    expect(html).toContain('data-specimen-screen="with-card"');
    expect(html).toContain('data-layout="center"');
    expect(html).toContain('data-layout="dock"');
  });

  it("shows the materials, parts and brief 015 extras", () => {
    for (const m of ["blueprint", "blueprint-box", "glass", "brass", "paper", "gold"]) expect(html).toContain(`data-material="${m}"`);
    for (const p of ["rivet", "plate", "lamp", "fig"]) expect(html).toContain(`data-part-name="${p}"`);
    for (const s of ["card-rows", "card-rows-closed", "source-rows", "kind-glyphs", "seal", "chips-motion"]) expect(html).toContain(`data-specimen="${s}"`);
    for (const s of ["sheet-modal", "sheet-two-tap", "jar-motes", "strip-stepper"]) expect(html).toContain(`data-specimen="${s}"`);
    for (const s of ["lab-receipt", "odometer-steps", "odometer-reduced", "lab-receipt-reduced"]) expect(html).toContain(`data-specimen="${s}"`);
    for (const c of ["company-off", "company-on", "company-disabled", "forget-ready", "forget-pending", "forget-none", "company-live", "forget-live", "reduced"]) {
      expect(html).toContain(`data-control="${c}"`);
    }
    const order = ["materials", "card-extras", "memory-extras", "instrument-extras", "controls"].map((id) => html.indexOf(`data-section-id="${id}"`));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("shows a call on the screen: the tool answer's cards, escaped, and the toggle's states (brief 044)", () => {
    for (const sp of ["call-cards", "call-cards-markup", "company-tap", "company-gated"]) expect(html).toContain(`data-specimen="${sp}"`);
    expect(html).toContain("Three quick dinners");
    // The second card shows only its edge behind the first, as the Card_Dock stacks every card.
    const callTile = html.slice(html.indexOf('data-specimen="call-cards"'), html.indexOf('data-specimen="call-cards-markup"'));
    expect(callTile.match(/data-depth="/g)).toHaveLength(2);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("This visit has ended.");
  });

  it("calls no /api/ route and exports the sentinel", () => {
    expect(html).not.toContain("/api/");
    expect(SPECIMENS_SENTINEL_9c41).toBe("SPECIMENS_SENTINEL_9c41");
  });
});
