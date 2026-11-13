// The specimens page's Bank section (brief 046 part B): every phase of the bank machine, with no network.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COPY } from "../../ui/copy";
import type { BankPhase } from "../../ui/bank/bank-machine";
import { bankSpecimens } from "./_fixtures/bank";
import SpecimensPage from "./page.dev";

const html = renderToStaticMarkup(<SpecimensPage />);
const PHASES: BankPhase[] = ["reading", "readFailed", "idle", "preparing", "linking", "connecting", "confirming", "disconnecting"];

describe("Specimens_Page: Bank", () => {
  it("has a Bank section that walks every phase the sheet can show", () => {
    expect(html).toContain('data-section-id="bank"');
    const shown = new Set([...html.matchAll(/data-bank-phase="([a-zA-Z]+)"/g)].map((m) => m[1]));
    for (const p of PHASES) expect(shown).toContain(p);
  });

  it("shows each specimen tile, the notes worth seeing and the way in", () => {
    for (const s of bankSpecimens()) expect(html).toContain(`data-bank-tile="${s.id}"`);
    for (const t of ["way-in-unlit", "way-in-lit", "way-in-disabled"]) expect(html).toContain(`data-bank-tile="${t}"`);
    expect(html).toContain(COPY.bank.needsReconnect);
    expect(html).toContain(COPY.bank.importing);
    expect(html).toContain(COPY.bank.linking.replace(/'/g, "&#x27;"));
  });

  it("loads no Plaid script and calls no route", () => {
    expect(html).not.toContain("cdn.plaid.com");
    expect(html).not.toContain("/api/");
  });
});
