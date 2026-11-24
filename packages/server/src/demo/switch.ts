/**
 * The demo switch (brief 054, R15). The demo is on only where the deployment says so, and fails closed: anything but
 * the exact string "on" is off, so a typo, a stray space or an unset variable never opens anonymous sign-in.
 */
import type { Env } from "../config/env";

export const DEMO_ENV_VAR = "FRANKI_DEMO";

/** Exactly "on": no trim, no case folding. */
export const demoEnabled = (env: Env): boolean => env[DEMO_ENV_VAR] === "on";

/** The whole answer of `GET /api/demo`: one boolean, no tenant, nothing else. */
export const demoStatus = (env: Env): { enabled: boolean } => ({ enabled: demoEnabled(env) });
