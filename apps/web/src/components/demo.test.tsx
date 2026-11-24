// The Kiroween Demo on screen (brief 054, R1, R2.7, R3, R17): the button in each switch state, the signed-out panel
// with and without it, the account menu on a demo visit, the one line a real user sees, and both sheets with and
// without `simulated`.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BANK_READ, BANK_SIMULATED, BANK_ZONE, bankShowing, bankSimulated } from "../app/specimens/_fixtures/bank";
import { GOOGLE_CONNECTED, GOOGLE_ZONE, googleShowing, googleSimulated } from "../app/specimens/_fixtures/google";
import { DEMO_HREF, DEMO_NAME } from "../client/demo";
import { canStartLink } from "../ui/bank/bank-machine";
import { canConnectGoogle } from "../ui/google/google-machine";
import { COPY } from "../ui/copy";
import { LANDING } from "../ui/copy-landing";
import { ReducedMotionOverride } from "../ui/hooks/reduced-motion";
import { AccountMenu } from "./AccountMenu";
import { AuthPanel, type AuthPanelProps } from "./AuthPanel";
import { DemoButton } from "./DemoButton";
import { DemoSwitchLine } from "./DemoSwitchLine";
import { BankSheet } from "./bank/BankSheet";
import { GoogleSheet } from "./google/GoogleSheet";
import { DemoLink, DemoLinkView } from "./landing/DemoLink";

const noop = () => {};
const esc = (s: string) => s.replace(/'/g, "&#x27;");
const panel = (p: Partial<AuthPanelProps> = {}) =>
  renderToStaticMarkup(<AuthPanel state={{ kind: "signedOut", error: null }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} onDeleteAccount={async () => true} {...p} />);

describe("the Kiroween Demo button", () => {
  it("shows only once the switch has answered on, as a keyboard button with the exact label", () => {
    const on = renderToStaticMarkup(<DemoButton enabled disabled={false} onPress={noop} />);
    expect(on).toMatch(/^<button type="button" data-demo-button=""/);
    expect(on).toContain(`>${COPY.demo.button}</button>`);
    expect(COPY.demo.button).toBe("Kiroween Demo");
    // At least the 44 px target, in the sign-in button's brass.
    expect(on).toMatch(/class="[^"]*min-h-11[^"]*mat-brass[^"]*h-14/);
    expect(renderToStaticMarkup(<DemoButton enabled={false} disabled={false} onPress={noop} />)).toBe("");
    expect(renderToStaticMarkup(<DemoButton enabled={null} disabled={false} onPress={noop} />)).toBe("");
  });

  it("sits beside the sign-in button on the signed-out panel only when the switch is on", () => {
    const on = panel({ demoEnabled: true, onDemo: noop });
    expect(on).toContain(COPY.auth.signIn);
    expect(on).toContain("data-demo-button");
    expect(on.indexOf(COPY.auth.signIn)).toBeLessThan(on.indexOf(COPY.demo.button));
    for (const p of [{ demoEnabled: false, onDemo: noop }, { demoEnabled: null, onDemo: noop }, {}, { demoEnabled: true }]) {
      const h = panel(p);
      expect(h).toContain(COPY.auth.signIn);
      expect(h).not.toContain(COPY.demo.button);
    }
  });

  it("waits while Firebase is loading or a sign-in is out", () => {
    expect(panel({ demoEnabled: true, onDemo: noop, busy: true })).toMatch(/<button type="button" data-demo-button="" disabled=""/);
    expect(panel({ demoEnabled: true, onDemo: noop, state: { kind: "loading" } })).toMatch(/<button type="button" data-demo-button="" disabled=""/);
  });

  it("shows a failed demo sign-in in plain words", () => {
    const h = panel({ demoEnabled: true, onDemo: noop, state: { kind: "signedOut", error: { cause: "providerError", message: COPY.demo.signInFailed } } });
    expect(h).toContain('role="alert"');
    expect(h).toContain(esc(COPY.demo.signInFailed));
  });

  it("on the front door, is a plain link to the Lab's marker, and nothing until the switch says on", () => {
    const on = renderToStaticMarkup(<DemoLinkView enabled />);
    expect(on).toMatch(new RegExp(`^<a href="${DEMO_HREF}" data-demo-link="" class="[^"]*mat-brass[^"]*">`));
    expect(on).toContain(LANDING.hero.demo);
    expect(LANDING.hero.demo).toBe("Kiroween Demo");
    expect(renderToStaticMarkup(<DemoLinkView enabled={false} />)).toBe("");
    expect(renderToStaticMarkup(<DemoLinkView enabled={null} />)).toBe("");
    // The server render has no answer yet, so it draws nothing.
    expect(renderToStaticMarkup(<DemoLink read={async () => true} />)).toBe("");
  });
});

describe("the account menu on a demo visit", () => {
  it("shows the persona's name and a Demo mark, never (no email), and keeps Sign out and Delete my data", () => {
    const h = panel({ state: { kind: "signedIn", email: DEMO_NAME, uid: "u1", anonymous: true } });
    expect(h).toContain(DEMO_NAME);
    expect(h).toContain(`data-demo-mark="" aria-hidden="true"`);
    expect(h).toContain(`>${COPY.demo.mark}</span>`);
    expect(h).toContain(`aria-label="${COPY.account.menu}: ${DEMO_NAME}, ${COPY.demo.mark}"`);
    expect(h).not.toContain("(no email)");
    expect(h).toContain(COPY.account.title);
  });

  it("is unchanged for a signed-in owner", () => {
    const owner = renderToStaticMarkup(<AccountMenu email="owner@example.com" onSignOut={noop} onDeleteAccount={async () => true} />);
    const viaPanel = panel({ state: { kind: "signedIn", email: "owner@example.com", uid: "u2" } });
    expect(owner).not.toContain("data-demo-mark");
    expect(viaPanel).not.toContain("data-demo-mark");
    expect(owner).toContain(`aria-label="${COPY.account.menu}: owner@example.com"`);
  });
});

describe("the switch line for a real user at /lab#demo", () => {
  it("is one line and one brass button", () => {
    const h = renderToStaticMarkup(<DemoSwitchLine busy={false} onSwitch={noop} />);
    expect(h.match(/<button/g)).toHaveLength(1);
    expect(h.match(/<p/g)).toHaveLength(1);
    expect(h).toContain(esc(COPY.demo.switchLine));
    expect(h).toContain(`>${COPY.demo.switchButton}</button>`);
    expect(COPY.demo.switchButton).toBe("Sign out and open the demo");
    expect(h).toMatch(/data-action="demo-switch" class="[^"]*mat-brass/);
    expect(renderToStaticMarkup(<DemoSwitchLine busy onSwitch={noop} />)).toMatch(/disabled=""/);
  });
});

describe("the sheets on a demo visit", () => {
  const bank = (s: ReturnType<typeof bankShowing>) =>
    renderToStaticMarkup(
      <ReducedMotionOverride reduced>
        <BankSheet state={s} zone={BANK_ZONE} onClose={noop} onRetry={noop} onConnect={noop} onDisconnect={noop} onYes={noop} onNotNow={noop} />
      </ReducedMotionOverride>,
    );
  const google = (s: ReturnType<typeof googleShowing>) =>
    renderToStaticMarkup(
      <ReducedMotionOverride reduced>
        <GoogleSheet state={s} zone={GOOGLE_ZONE} inApp={null} onClose={noop} onRetry={noop} onConnect={noop} onStopWaiting={noop} onDisconnect={noop} onYes={noop} onNotNow={noop} />
      </ReducedMotionOverride>,
    );

  it("the bank sheet shows the bank and its accounts, says it is simulated, and offers neither Connect nor Disconnect", () => {
    const s = bankSimulated();
    expect(canStartLink(s)).toBe(false);
    const h = bank(s);
    expect(h).toContain(BANK_SIMULATED.institutionName!);
    expect(h).toContain(COPY.bank.account(BANK_SIMULATED.accounts[0]!.name, BANK_SIMULATED.accounts[0]!.mask));
    expect(h).toContain(COPY.bank.simulated);
    expect(h).not.toContain('data-action="bank-connect"');
    expect(h).not.toContain('data-action="bank-disconnect"');
    expect(h).not.toContain(COPY.bank.plaid);
    // canConnect is false on a demo visit, which is not the bank limit.
    expect(h).not.toContain(esc(COPY.bank.limit(4)));
  });

  it("a sample visit's bank sheet is unchanged", () => {
    const h = bank(bankShowing([BANK_READ]));
    expect(h).not.toContain(COPY.bank.simulated);
    expect(h).toContain('data-action="bank-disconnect"');
    expect(h).toContain('data-action="bank-connect"');
  });

  it("the Google sheet shows the connection, says it is simulated, and offers neither Connect, Disconnect nor Google's steps", () => {
    const s = googleSimulated();
    expect(canConnectGoogle(s)).toBe(false);
    const h = google(s);
    expect(h).toContain("jeffrey@kisses.example");
    expect(h).toContain(COPY.google.part.mail.connected);
    expect(h).toContain(COPY.google.simulated);
    expect(h).not.toContain('data-action="google-connect"');
    expect(h).not.toContain('data-action="google-disconnect"');
    expect(h).not.toContain("data-google-guide");
    expect(h).not.toContain("data-google-in-app");
    expect(h).not.toContain(esc(COPY.google.signIn));
  });

  it("a real connection's Google sheet is unchanged", () => {
    const h = google(googleShowing(GOOGLE_CONNECTED));
    expect(h).not.toContain(COPY.google.simulated);
    expect(h).toContain('data-action="google-disconnect"');
  });
});
