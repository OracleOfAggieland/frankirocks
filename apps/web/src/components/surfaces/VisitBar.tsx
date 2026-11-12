// The visit's controls beside the lab (brief 027): the time bolt, Start over with its one confirmation, and the
// visit's state while it clones, resets or has failed. Props only; the machine is `ui.visit`
// (`ui/visit/visit-machine.ts`). The bolt offers labeled targets, never a free date field.
import { COPY } from "../../ui/copy";
import type { BoltTarget } from "../../ui/visit/bolt-targets";
import type { BoltPhase, VisitFailure, VisitPhase } from "../../ui/visit/visit-machine";
import { FOCUS, QUIET_BUTTON, TARGET } from "./classes";

export interface VisitBarProps {
  phase: VisitPhase;
  failure: VisitFailure | null;
  bolt: BoltPhase;
  boltFailed: boolean;
  confirming: boolean;
  endingCall: boolean;
  /** The bolt's targets; pressable only while `boltEnabled`. */
  targets: readonly BoltTarget[];
  boltEnabled: boolean;
  onBolt: (toMs: number) => void;
  onRetry: () => void;
  onStartOver: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const BOLT_BUTTON = `${TARGET} ${FOCUS} mat-glass inline-flex items-center gap-1.5 rounded-chip border border-brass px-3 text-sm text-ink hover:bg-night-2/90 disabled:opacity-40`;

function Bolt() {
  return (
    <svg viewBox="0 0 12 16" aria-hidden="true" focusable="false" className="h-3.5 w-2.5 shrink-0 text-brass">
      <path d="M7.2 0.6 L1.4 9 H5.6 L4.2 15.4 L10.6 6.2 H6.5 Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

function boltStatus(p: VisitBarProps): string {
  if (p.bolt === "waiting") return COPY.visit.bolt.waiting;
  if (p.bolt === "moving") return COPY.visit.bolt.moving;
  if (p.boltFailed) return COPY.visit.bolt.didNotMove;
  return "";
}

export function VisitBar(p: VisitBarProps) {
  if (p.phase === "none" || p.phase === "cloning" || p.phase === "resetting") {
    const text = p.phase === "resetting" ? (p.endingCall ? COPY.visit.endingCall : COPY.visit.resetting) : COPY.visit.cloning;
    return (
      <div data-visit={p.phase} className="flex justify-center">
        <p role="status" data-visit-status="" className="text-sm text-ink-dim">
          {text}
        </p>
      </div>
    );
  }
  if (p.phase === "failed") {
    return (
      <div data-visit="failed" className="flex flex-col items-center gap-2">
        <p role="alert" className="text-sm text-ink">
          {COPY.visit.failed[p.failure ?? "clone"]}
        </p>
        <button type="button" data-action="retry-visit" className={QUIET_BUTTON} onClick={p.onRetry}>
          {COPY.visit.retry}
        </button>
      </div>
    );
  }
  const status = boltStatus(p);
  return (
    <div data-visit="ready" className="flex flex-col items-center gap-2">
      <div role="group" aria-label={COPY.visit.bolt.label} data-bolt={p.bolt} className="flex max-w-[343px] flex-wrap justify-center gap-2 sm:max-w-xl">
        {p.targets.map((t) => (
          <button key={t.id} type="button" data-bolt-target={t.id} disabled={!p.boltEnabled} className={BOLT_BUTTON} onClick={() => p.onBolt(t.toMs)}>
            <Bolt />
            {t.label}
          </button>
        ))}
      </div>
      <p role="status" data-bolt-status="" className="min-h-5 text-xs text-ink-dim">
        {status}
      </p>
      {p.confirming ? (
        <div role="alertdialog" aria-label={COPY.visit.startOver} data-start-over="confirming" className="flex flex-col items-center gap-2">
          <p className="text-sm text-ink">{COPY.visit.confirm.question}</p>
          <div className="flex gap-2">
            <button type="button" data-action="confirm-start-over" className={QUIET_BUTTON} onClick={p.onConfirm}>
              {COPY.visit.confirm.yes}
            </button>
            <button type="button" data-action="cancel-start-over" className={QUIET_BUTTON} onClick={p.onCancel}>
              {COPY.visit.confirm.no}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" data-action="start-over" disabled={p.bolt === "moving"} className={`${QUIET_BUTTON} text-sm`} onClick={p.onStartOver}>
          {COPY.visit.startOver}
        </button>
      )}
    </div>
  );
}
