// The Google sheet's drawing and its specimens (brief 049 part B): short, only what the server answered, no field of
// its own, no mail or events, a disconnect that asks Yes or Not now with neither pre-selected, and a specimens
// section that walks every phase with no network.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTED, GOOGLE_EXPIRED, GOOGLE_MAIL_ONLY, GOOGLE_OFF, GOOGLE_ZONE, googleAfter, googleShowing, googleSpecimens } from "../../app/specimens/_fixtures/google";
import SpecimensPage from "../../app/specimens/page.dev";
import { COPY } from "../../ui/copy";
import { type GooglePhase, type GoogleState, INITIAL_GOOGLE } from "../../ui/google/google-machine";
import { ReducedMotionOverride } from "../../ui/hooks/reduced-motion";
import { GoogleSheet, googleStatusLine } from "./GoogleSheet";
import { GoogleWayIn, googleLit } from "./GoogleWayIn";

const noop = () => {};
const actions = { onClose: noop, onRetry: noop, onConnect: noop, onStopWaiting: noop, onDisconnect: noop, onYes: noop, onNotNow: noop };
const draw = (state: GoogleState) =>
  renderToStaticMarkup(
    <ReducedMotionOverride reduced>
      <GoogleSheet state={state} zone={GOOGLE_ZONE} {...actions} />
    </ReducedMotionOverride>,
  );
const esc = (s: string) => s.replace(/'/g, "&#x27;");

describe("GoogleSheet", () => {
  it("says what Franki can and can't do, that the sign-in is Google's, and offers Connect", () => {
    const html = draw(googleShowing(GOOGLE_OFF));
    expect(html).toContain(esc(COPY.google.readOnly));
    expect(html).toContain(esc(COPY.google.signIn));
    expect(html).toContain(COPY.google.connect);
    expect(html).toContain(COPY.google.none);
  });

  it("has no field of its own, and no link anywhere", () => {
    for (const s of googleSpecimens()) {
      const html = draw(s.state);
      expect(html).not.toMatch(/<input|<textarea|<select|contenteditable|<a\s|<iframe/);
    }
  });

  it("shows the address and both parts when connected, with Disconnect and no Connect", () => {
    const html = draw(googleShowing(GOOGLE_CONNECTED));
    expect(html).toContain(GOOGLE_CONNECTED.email!);
    expect(html).toContain(COPY.google.part.mail.connected);
    expect(html).toContain(COPY.google.part.calendar.connected);
    expect(html).toContain('data-action="google-disconnect"');
    expect(html).not.toContain('data-action="google-connect"');
  });

  it("offers Connect again for a part not granted, and for a new sign-in", () => {
    const partial = draw(googleShowing(GOOGLE_MAIL_ONLY));
    expect(partial).toContain(COPY.google.part.calendar.off);
    expect(partial).toContain(COPY.google.connectAgain);
    const expired = draw(googleShowing(GOOGLE_EXPIRED));
    expect(expired).toContain(COPY.google.needsReconnect);
    expect(expired).toContain(COPY.google.connectAgain);
  });

  it("asks before disconnecting, with Yes and Not now and neither pre-selected", () => {
    const html = draw(googleAfter([{ kind: "disconnectPressed", at: 1 }], googleShowing(GOOGLE_CONNECTED)));
    expect(html).toContain(esc(COPY.google.confirm));
    expect(html).toContain('data-action="google-yes"');
    expect(html).toContain('data-action="google-not-now"');
    expect(html).not.toMatch(/autofocus|aria-pressed="true"|data-selected/i);
  });

  it("offers Stop waiting while Google's window is out", () => {
    const s = googleSpecimens().find((x) => x.id === "authorizing")!.state;
    const html = draw(s);
    expect(html).toContain(COPY.google.stopWaiting);
    expect(html).toContain(esc(COPY.google.authorizing));
  });

  it("draws the address as text: markup in it is escaped", () => {
    const html = draw(googleShowing({ ...GOOGLE_CONNECTED, email: "<img src=x onerror=alert(1)>@example.com" }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("has one status line for every phase and note", () => {
    expect(googleStatusLine(INITIAL_GOOGLE)).toBeNull();
    for (const s of googleSpecimens()) if (s.state.note !== null) expect(googleStatusLine(s.state)).toBe(COPY.google.notes[s.state.note]);
  });

  it("the way in is lit only while mail or calendar is read", () => {
    expect(googleLit(null)).toBe(false);
    expect(googleLit(GOOGLE_OFF)).toBe(false);
    expect(googleLit(GOOGLE_EXPIRED)).toBe(false);
    expect(googleLit(GOOGLE_MAIL_ONLY)).toBe(true);
    expect(renderToStaticMarkup(<GoogleWayIn google={null} open={false} onOpen={noop} />)).toContain(COPY.google.open);
  });
});

describe("Specimens_Page: Google", () => {
  const html = renderToStaticMarkup(<SpecimensPage />);
  const PHASES: GooglePhase[] = ["reading", "readFailed", "notConfigured", "idle", "starting", "authorizing", "confirming", "disconnecting"];

  it("walks every phase the sheet can show, each tile, and the way in", () => {
    expect(html).toContain('data-section-id="google"');
    const shown = new Set([...html.matchAll(/data-google-phase="([a-zA-Z]+)"/g)].map((m) => m[1]));
    for (const p of PHASES) expect(shown).toContain(p);
    for (const s of googleSpecimens()) expect(html).toContain(`data-google-tile="${s.id}"`);
    for (const t of ["way-in-unlit", "way-in-lit"]) expect(html).toContain(`data-google-tile="${t}"`);
  });

  it("calls no route and links to no Google page", () => {
    expect(html).not.toContain("/api/google");
    expect(html).not.toContain("accounts.google.com");
  });
});
