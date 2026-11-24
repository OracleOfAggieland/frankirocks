// The Lab's Kiroween Demo button (brief 054, R1.2, R1.4, R1.6): beside "Sign in to wake Franki" on the signed-out
// panel, built the way that button is (brass you can touch, 2 px press, a 44 px target or more). It lives here and not
// under components/landing/, so the Lab imports nothing of the front door's. It renders nothing until the switch has
// answered on.
import { COPY } from "../ui/copy";
import { FOCUS, TARGET } from "./surfaces/classes";

/** The same brass as the sign-in button beside it. */
export const DEMO_BUTTON_CLASS = `${TARGET} ${FOCUS} mat-brass inline-flex h-14 items-center justify-center gap-2.5 rounded-chip px-7 text-base font-medium transition-[transform,filter] duration-(--dur-quick) hover:brightness-110 active:translate-y-0.5 disabled:opacity-50 disabled:hover:brightness-100`;

export interface DemoButtonProps {
  /** The switch's answer: null until it has answered. Only true shows the button. */
  enabled: boolean | null;
  /** True while a sign-in is out, or before Firebase has reported, so a second press does nothing. */
  disabled: boolean;
  onPress: () => void;
}

export function DemoButton({ enabled, disabled, onPress }: DemoButtonProps) {
  if (enabled !== true) return null;
  return (
    <button type="button" data-demo-button="" onClick={onPress} disabled={disabled} className={DEMO_BUTTON_CLASS}>
      {COPY.demo.button}
    </button>
  );
}
