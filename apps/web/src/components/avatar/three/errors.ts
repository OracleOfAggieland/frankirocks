// The engine's errors (brief 013, design note §3.3). New code: replaces the prototype's `fatal` (franki.html
// 793-798), whose page panel is not ported. The failure names live in the pure renderer-phase module, so ui/
// never imports from components/.
import type { EngineFailure } from "../../../ui/avatar/renderer-phase";

export type { EngineFailure };

export class EngineError extends Error {
  readonly reason: EngineFailure;

  constructor(reason: EngineFailure, detail: string) {
    super(detail);
    this.name = "EngineError";
    this.reason = reason;
  }
}

