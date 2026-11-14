/**
 * Brief 049 ruling 27: Google's settings, read by name only. `GOOGLE_OAUTH_CLIENT_ID` is a plain value and
 * `GOOGLE_OAUTH_CLIENT_SECRET` a secret; the refresh token is sealed under the bank's key (`FRANKI_BANK_TOKEN_KEY`,
 * ruling 17). A missing or malformed setting is a ConfigError naming the variable; the routes answer CONFIG with no
 * detail in the body, the sheet says Google is not set up, and the errand tool answers `unavailable`.
 */
import { type Env, ConfigError, requireEnv } from "../config/env";
import { type SealKeys, sealKeysFrom } from "../sealed";

export const GOOGLE_ENV_VARS = {
  clientId: "GOOGLE_OAUTH_CLIENT_ID",
  clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET",
  tokenKey: "FRANKI_BANK_TOKEN_KEY",
} as const;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  tokenKeys: SealKeys;
}

export function googleConfig(env: Env): GoogleConfig {
  const clientId = requireEnv(GOOGLE_ENV_VARS.clientId, env).trim();
  const clientSecret = requireEnv(GOOGLE_ENV_VARS.clientSecret, env).trim();
  if (!/^[A-Za-z0-9._-]{8,200}\.apps\.googleusercontent\.com$/.test(clientId)) throw new ConfigError(GOOGLE_ENV_VARS.clientId);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientSecret)) throw new ConfigError(GOOGLE_ENV_VARS.clientSecret);
  return { clientId, clientSecret, tokenKeys: sealKeysFrom(env, GOOGLE_ENV_VARS.tokenKey) };
}

/** True when every Google setting is present and well formed (for `start_errand`'s `unavailable`). */
export function googleConfigured(env: Env): boolean {
  try {
    googleConfig(env);
    return true;
  } catch (error) {
    if (error instanceof ConfigError) return false;
    throw error;
  }
}
