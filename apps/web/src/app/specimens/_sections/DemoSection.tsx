"use client";
// The Kiroween Demo (brief 054), drawn from fixtures with no network and no sign-in: the Lab's signed-out panel with
// the switch on, off and not answered yet; the front door's link in the same three; the account menu on a demo visit
// beside a signed-in owner's; the one line a real user sees at /lab#demo; and both sheets as a demo visit sees them.
import { DEMO_NAME } from "../../../client/demo";
import { AccountMenu } from "../../../components/AccountMenu";
import { AuthPanel } from "../../../components/AuthPanel";
import { DemoSwitchLine } from "../../../components/DemoSwitchLine";
import { BankSheet } from "../../../components/bank/BankSheet";
import { GoogleSheet } from "../../../components/google/GoogleSheet";
import { DemoLinkView } from "../../../components/landing/DemoLink";
import { BANK_ZONE, bankSimulated } from "../_fixtures/bank";
import { GOOGLE_ZONE, googleSimulated } from "../_fixtures/google";
import { COPY } from "../../../ui/copy";
import { Section, Tile } from "./Section";

const noop = () => {};
const done = async () => true;
const signedOut = { kind: "signedOut", error: null } as const;
const bankActions = { onClose: noop, onRetry: noop, onConnect: noop, onDisconnect: noop, onYes: noop, onNotNow: noop };
const googleActions = { onClose: noop, onRetry: noop, onConnect: noop, onStopWaiting: noop, onDisconnect: noop, onYes: noop, onNotNow: noop };

const SWITCH: { id: string; label: string; enabled: boolean | null }[] = [
  { id: "on", label: "switch on", enabled: true },
  { id: "off", label: "switch off: no button", enabled: false },
  { id: "unanswered", label: "switch not answered yet: no button", enabled: null },
];

export function DemoSection() {
  return (
    <Section id="kiroween-demo" title="Kiroween Demo">
      {SWITCH.map((s) => (
        <Tile key={`panel-${s.id}`} label={`Lab, signed out: ${s.label}`} data-specimen="kiroween-demo" data-demo-tile={`panel-${s.id}`}>
          <AuthPanel state={signedOut} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} onDeleteAccount={done} demoEnabled={s.enabled} onDemo={noop} />
        </Tile>
      ))}
      <Tile label="Lab, signed out: the demo's sign-in failed" data-specimen="kiroween-demo" data-demo-tile="panel-failed">
        <AuthPanel
          state={{ kind: "signedOut", error: { cause: "providerError", message: `${COPY.demo.signInFailed} Error code: auth/network-request-failed.` } }}
          busy={false}
          configMissing={null}
          onSignIn={noop}
          onSignOut={noop}
          onDeleteAccount={done}
          demoEnabled
          onDemo={noop}
        />
      </Tile>
      {SWITCH.map((s) => (
        <Tile key={`link-${s.id}`} label={`Front door: ${s.label}`} data-specimen="kiroween-demo" data-demo-tile={`link-${s.id}`}>
          <DemoLinkView enabled={s.enabled} />
        </Tile>
      ))}
      <Tile label="Account menu, demo visit" data-specimen="kiroween-demo" data-demo-tile="menu-demo">
        <AuthPanel state={{ kind: "signedIn", email: DEMO_NAME, uid: "anon-specimen", anonymous: true }} busy={false} configMissing={null} onSignIn={noop} onSignOut={noop} onDeleteAccount={done} />
      </Tile>
      <Tile label="Account menu, signed-in owner (unchanged)" data-specimen="kiroween-demo" data-demo-tile="menu-owner">
        <AccountMenu email="dana.whitlock@example.com" onSignOut={noop} onDeleteAccount={done} />
      </Tile>
      <Tile label="A real user at /lab#demo" data-specimen="kiroween-demo" data-demo-tile="switch-line">
        <DemoSwitchLine busy={false} onSwitch={noop} />
      </Tile>
      <Tile label="A real user at /lab#demo: after the press" data-specimen="kiroween-demo" data-demo-tile="switch-line-busy">
        <DemoSwitchLine busy onSwitch={noop} />
      </Tile>
      <Tile label="Bank sheet, demo visit" data-specimen="kiroween-demo" data-demo-tile="bank-simulated">
        <BankSheet state={bankSimulated()} zone={BANK_ZONE} {...bankActions} />
      </Tile>
      <Tile label="Gmail and Calendar sheet, demo visit" data-specimen="kiroween-demo" data-demo-tile="google-simulated">
        <GoogleSheet state={googleSimulated()} zone={GOOGLE_ZONE} inApp={null} {...googleActions} />
      </Tile>
    </Section>
  );
}
