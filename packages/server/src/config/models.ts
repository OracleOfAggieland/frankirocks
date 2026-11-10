import type { HealthConfig } from "../health";
import { type Env, requireEnv } from "./env";

/**
 * The only module that reads Model_Config, and the only source file allowed to hold model ID literals
 * (R30.1, R30.2). Model IDs themselves live in apps/web/apphosting.yaml.
 */
export const MODEL_VARS = {
  voice: "FRANKI_VOICE_MODEL",
  brain: "FRANKI_BRAIN_MODEL",
  escalate: "FRANKI_ESCALATE_MODEL",
  bg: "FRANKI_BG_MODEL",
  embed: "FRANKI_EMBED_MODEL",
  transcribe: "FRANKI_TRANSCRIBE_MODEL",
  /** Judge spike only: text-to-speech for the synthetic probe audio (brief 006 item 3). */
  tts: "FRANKI_TTS_MODEL",
} as const;

export type ModelUse = keyof typeof MODEL_VARS;

/** Returns the configured model ID for `use`, or throws ConfigError naming the variable (R30.3). */
export function requireModel(use: ModelUse, env: Env = process.env): string {
  return requireEnv(MODEL_VARS[use], env);
}

/**
 * `/api/health` fallbacks, unchanged from before this slice (contract question 9).
 * The deep check falls back to these when the variable is unset.
 */
const HEALTH_FALLBACKS: HealthConfig = { brainModel: "gpt-6.1-terra", voiceModel: "gpt-realtime-2.1" };

/** Models for the deep health check (`POST /api/health`). */
export function healthModels(env: Env = process.env): HealthConfig {
  return {
    brainModel: env[MODEL_VARS.brain] ?? HEALTH_FALLBACKS.brainModel,
    voiceModel: env[MODEL_VARS.voice] ?? HEALTH_FALLBACKS.voiceModel,
  };
}

/** Models reported by the public liveness probe (`GET /api/health`): the raw values, or null. */
export function configuredModels(env: Env = process.env): { brainModel: string | null; voiceModel: string | null } {
  return { brainModel: env[MODEL_VARS.brain] ?? null, voiceModel: env[MODEL_VARS.voice] ?? null };
}
