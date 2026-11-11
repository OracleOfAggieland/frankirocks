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

/** The marker every unported stub throws with. I2 checks that no file under three/ still contains it. */
export const NOT_PORTED = "not ported yet";

/** The body of a scaffold stub. */
export function notPorted(name: string, ...inputs: unknown[]): never {
  throw new EngineError("build", `${name}: ${NOT_PORTED} (${inputs.length} inputs)`);
}
