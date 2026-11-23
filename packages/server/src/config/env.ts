/**
 * Environment readers (R30.3, R30.4, R30.11). Errors name the variable and never include any value.
 * Model_Config variables are read only through ./models.ts.
 */
export type Env = Readonly<Record<string, string | undefined>>;

/** A missing or empty config variable. `detail` names the variable only. */
export class ConfigError extends Error {
  readonly code = "CONFIG" as const;
  readonly variable: string;

  constructor(variable: string) {
    super(`CONFIG: ${variable} is not set`);
    this.name = "ConfigError";
    this.variable = variable;
  }

  get detail(): string {
    return `${this.variable} is not set`;
  }
}

/** Returns the value, or throws ConfigError when it is unset, empty or whitespace-only. */
export function requireEnv(name: string, env: Env = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") throw new ConfigError(name);
  return value;
}

export const ENV_VARS = {
  openaiApiKey: "OPENAI_API_KEY",
  idHmacKey: "FRANKI_ID_HMAC_KEY",
  firebaseProjectId: "FRANKI_FIREBASE_PROJECT_ID",
} as const;

export const openaiApiKey = (env: Env = process.env): string => requireEnv(ENV_VARS.openaiApiKey, env);
export const idHmacKey = (env: Env = process.env): string => requireEnv(ENV_VARS.idHmacKey, env);
export const firebaseProjectId = (env: Env = process.env): string => requireEnv(ENV_VARS.firebaseProjectId, env);

/**
 * Company mode (brief 053; owner, Nov 18: off by default, since its check misfired in live calls). On only when
 * FRANKI_COMPANY_MODE is "on".
 */
export function companyModeOn(env: Env = process.env): boolean {
  return env.FRANKI_COMPANY_MODE === "on";
}

/** True when NODE_ENV is "production". */
export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}
