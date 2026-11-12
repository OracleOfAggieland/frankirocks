// The switch at the foot of the page. For now a plain link to the lab.
import { LANDING } from "../../ui/copy-landing";
import type { SwitchProps } from "../../ui/landing/steps";
import { FOCUS, TARGET } from "../surfaces/classes";

export function Switch(props: SwitchProps) {
  const { wake } = LANDING.sections;
  return (
    <section id="wake" aria-labelledby="wake-title" className="flex flex-col items-center gap-6 py-24 text-center">
      <h2 id="wake-title" className="font-display text-title text-ink">
        {wake.title}
      </h2>
      <a href={props.href} className={`${TARGET} ${FOCUS} mat-brass inline-flex items-center rounded-control px-5 text-base font-medium`}>
        {wake.lever}
      </a>
      <p className="text-lg text-ink">{wake.signature}</p>
      <p className="text-sm text-ink-dim">{wake.note}</p>
    </section>
  );
}
