// The stage on the right, which acts out the story on a sample month. For now an empty box: no sample data
// and no Franki yet.
import { LANDING } from "../../ui/copy-landing";
import type { DemoStageProps } from "../../ui/landing/steps";

export function DemoStage(props: DemoStageProps) {
  return (
    <section aria-label={LANDING.stage.label} data-demo-stage="" data-step={props.step} className="py-8">
      <div aria-hidden="true" data-stage-placeholder="" className="mat-blueprint-box aspect-square w-full max-w-[420px] rounded-frame" />
    </section>
  );
}
