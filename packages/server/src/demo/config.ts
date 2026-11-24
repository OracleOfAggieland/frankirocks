/**
 * The settings a demo visit needs and no more (brief 054, R10.11). A deployment with the demo on and no Plaid or
 * Google client settings still has to unseal the demo connectors' tokens, so the token key is read for real; the
 * client fields are placeholders. They are only ever paired with a refusing live port (`refusingBank`,
 * `refusingGoogle` in `routing.ts`), so they can never reach a provider: the simulators ignore them.
 */
import { BANK_ENV_VARS, type BankConfig } from "../bank/config";
import type { Env } from "../config/env";
import { GOOGLE_ENV_VARS, type GoogleConfig } from "../google/config";
import { sealKeysFrom } from "../sealed";

/** Bank settings for a demo-only deployment. A missing token key is a ConfigError, as for a real bank. */
export function demoBankConfig(env: Env): BankConfig {
  return { clientId: "demo", secret: "demo", environment: "sandbox", tokenKeys: sealKeysFrom(env, BANK_ENV_VARS.tokenKey) };
}

/** Google settings for a demo-only deployment: the same token key (Google seals under the bank's key). */
export function demoGoogleConfig(env: Env): GoogleConfig {
  return { clientId: "demo", clientSecret: "demo", redirectUri: "http://localhost/google/callback", tokenKeys: sealKeysFrom(env, GOOGLE_ENV_VARS.tokenKey) };
}
