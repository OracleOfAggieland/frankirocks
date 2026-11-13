/**
 * Brief 046 ruling 1: the bank's settings, read by name only, as `phoneConfig` reads Twilio's. A missing or malformed
 * setting is a ConfigError naming the variable; the route answers CONFIG with no detail in its body.
 */
import { type Env, ConfigError, requireEnv } from "../config/env";

export const BANK_ENV_VARS = {
  clientId: "PLAID_CLIENT_ID",
  secret: "PLAID_SECRET",
  env: "PLAID_ENV",
  tokenKey: "FRANKI_BANK_TOKEN_KEY",
} as const;

export const BANK_ENVIRONMENTS = ["production", "sandbox"] as const;
export type BankEnvironment = (typeof BANK_ENVIRONMENTS)[number];

export interface BankConfig {
  clientId: string;
  secret: string;
  environment: BankEnvironment;
  /** The token key, version 1 (ruling 2). 32 bytes. */
  tokenKeys: { 1: Buffer };
}

export function bankConfig(env: Env): BankConfig {
  const clientId = requireEnv(BANK_ENV_VARS.clientId, env).trim();
  const secret = requireEnv(BANK_ENV_VARS.secret, env).trim();
  const environment = requireEnv(BANK_ENV_VARS.env, env).trim();
  if (!(BANK_ENVIRONMENTS as readonly string[]).includes(environment)) throw new ConfigError(BANK_ENV_VARS.env);
  const rawKey = requireEnv(BANK_ENV_VARS.tokenKey, env).trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(rawKey)) throw new ConfigError(BANK_ENV_VARS.tokenKey);
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) throw new ConfigError(BANK_ENV_VARS.tokenKey);
  if (!/^[A-Za-z0-9]{1,64}$/.test(clientId)) throw new ConfigError(BANK_ENV_VARS.clientId);
  if (!/^[A-Za-z0-9]{1,64}$/.test(secret)) throw new ConfigError(BANK_ENV_VARS.secret);
  return { clientId, secret, environment: environment as BankEnvironment, tokenKeys: { 1: key } };
}
