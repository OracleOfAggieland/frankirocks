// The bank sheet's drawing (brief 046 part B): short, only what the server answered, no field of its own, no amounts,
// and a disconnect that asks Yes or Not now with neither pre-selected.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANK_EXPIRED, BANK_IMPORTING, BANK_READ, BANK_ZONE, bankAfter, bankShowing, bankSpecimens } from "../../app/specimens/_fixtures/bank";
import { type BankState, INITIAL_BANK } from "../../ui/bank/bank-machine";
import { bankLine, bankTime } from "../../ui/bank/bank-format";
import { COPY } from "../../ui/copy";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { BankSheet, bankStatusLine } from "./BankSheet";
import { BankWayIn, bankLit } from "./BankWayIn";

const noop = () => {};
const actions = { onClose: noop, onRetry: noop, onConnect: noop, onDisconnect: noop, onYes: noop, onNotNow: noop };
const draw = (state: BankState) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced>
      <BankSheet state={state} zone={BANK_ZONE} {...actions} />
    </ReducedMotionOverride>,
  );

describe("BankSheet", () => {
  it("says what Franki can and can't do, and that the sign-in is Plaid's", () => {
    const html = draw(bankShowing([]));
    expect(html).toContain(COPY.bank.readOnly.replace(/'/g, "&#x27;"));
    expect(html).toContain(COPY.bank.plaid.replace(/'/g, "&#x27;"));
    expect(html).toContain(COPY.bank.connect);
    expect(html).toContain(COPY.bank.none);
  });

  it("has no field of its own: Plaid's window takes the bank sign-in", () => {
    for (const s of bankSpecimens()) {
      const html = draw(s.state);
      expect(html).not.toMatch(/<input|<textarea|<select|contenteditable/);
      expect(html).not.toMatch(/password"|type="password"/);
    }
  });

  it("shows no amount or balance in any state", () => {
    for (const s of bankSpecimens()) expect(draw(s.state)).not.toMatch(/\$\s?\d|balance/i);
  });

  it("shows each bank with its accounts by name and last four, and when it was last read", () => {
    const html = draw(bankShowing([BANK_READ]));
    expect(html).toContain("Hollow Creek Bank");
    expect(html).toContain("Everyday checking ••0417");
    expect(html).toContain("Rainy day savings ••2290");
    expect(html).toContain(COPY.bank.lastRead(bankTime(BANK_READ.lastSyncedAt!, BANK_ZONE)!));
    expect(html).toContain('data-action="bank-disconnect"');
  });

  it("an importing bank says so; a bank that needs a new sign-in says so", () => {
    expect(draw(bankShowing([BANK_IMPORTING]))).toContain(COPY.bank.importing);
    expect(draw(bankShowing([BANK_EXPIRED]))).toContain(COPY.bank.needsReconnect);
  });

  it("shows nothing about banks before the server has answered", () => {
    const html = draw(bankAfter([{ kind: "opened", at: 0 }]));
    expect(html).toContain(COPY.bank.reading);
    expect(html).not.toContain("data-bank-list");
    expect(html).not.toContain(COPY.bank.none);
    expect(html).not.toContain(COPY.bank.connect);
  });

  it("the disconnect asks Yes or Not now, with neither pre-selected", () => {
    const asking = bankAfter([{ kind: "disconnectPressed", connectorId: BANK_READ.connectorId, at: 0 }], bankShowing([BANK_READ]));
    const html = draw(asking);
    expect(html).toContain(COPY.bank.confirm.replace(/'/g, "&#x27;"));
    expect(html).toContain('data-action="bank-yes"');
    expect(html).toContain('data-action="bank-not-now"');
    expect(html).not.toMatch(/autofocus|aria-pressed="true"|aria-checked/i);
  });

  it("at the limit, no Connect and a plain line", () => {
    const full = bankShowing([BANK_READ], false);
    const html = draw(full);
    expect(html).not.toContain('data-action="bank-connect"');
    expect(html).toContain("(4)");
  });

  it("a note is one plain line, never Plaid's text", () => {
    for (const note of Object.keys(COPY.bank.notes) as (keyof typeof COPY.bank.notes)[]) {
      expect(bankStatusLine({ ...bankShowing([]), note })).toBe(COPY.bank.notes[note]);
    }
    expect(bankStatusLine(bankShowing([]))).toBeNull();
    expect(bankStatusLine(INITIAL_BANK)).toBeNull();
  });

  it("the modal sheet is a dialog with aria-modal", () => {
    const html = renderToStaticMarkup(<BankSheet presentation="sheet" state={bankShowing([BANK_READ])} zone={BANK_ZONE} {...actions} />);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-presentation="sheet"');
  });
});

describe("bank words", () => {
  it("formats a time in the zone, and refuses a non-time", () => {
    expect(bankTime("2026-11-13T20:05:00.000Z", "America/Chicago")).toBe("Nov 13, 2:05 PM");
    expect(bankTime("not a time", "America/Chicago")).toBeNull();
  });

  it("a bank never read says so", () => {
    expect(bankLine({ ...BANK_READ, lastSyncedAt: null }, BANK_ZONE)).toBe(COPY.bank.notRead);
  });
});

describe("BankWayIn", () => {
  it("is one small control that opens a dialog", () => {
    const html = renderToStaticMarkup(<BankWayIn banks={null} open={false} onOpen={noop} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Bank<");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("data-lamp");
  });

  it("lights its lamp only once the server answered a bank being read", () => {
    expect(bankLit(null)).toBe(false);
    expect(bankLit([BANK_EXPIRED])).toBe(false);
    expect(bankLit([BANK_READ])).toBe(true);
    expect(renderToStaticMarkup(<BankWayIn banks={[BANK_READ]} open onOpen={noop} />)).toContain('data-lamp="on"');
  });
});
