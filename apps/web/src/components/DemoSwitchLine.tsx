// A real user arrived at the demo's link (brief 054, R2.7). Their session is never replaced silently: the Lab opens as
// them and shows this one line and one brass button. Only that press signs them out (closing their calls and
// Sessions, as a sign-out does) and starts the demo.
import { COPY } from "../ui/copy";
import { FOCUS, TARGET } from "./surfaces/classes";

const SWITCH = `${TARGET} ${FOCUS} mat-brass inline-flex min-h-11 items-center justify-center rounded-chip px-5 text-sm font-medium transition-[transform,filter] duration-(--dur-quick) hover:brightness-110 active:translate-y-0.5 disabled:opacity-50 disabled:hover:brightness-100`;

export interface DemoSwitchLineProps {
  /** True while the sign-out and the demo's sign-in run, so a second press does nothing. */
  busy: boolean;
  onSwitch: () => void;
}

export function DemoSwitchLine({ busy, onSwitch }: DemoSwitchLineProps) {
  return (
    <div role="group" aria-label={COPY.demo.button} data-demo-switch="" className="flex max-w-[343px] flex-col items-center gap-2 text-center sm:max-w-md">
      <p className="text-sm text-ink-dim">{COPY.demo.switchLine}</p>
      <button type="button" data-action="demo-switch" onClick={onSwitch} disabled={busy} className={SWITCH}>
        {busy ? COPY.demo.starting : COPY.demo.switchButton}
      </button>
    </div>
  );
}
