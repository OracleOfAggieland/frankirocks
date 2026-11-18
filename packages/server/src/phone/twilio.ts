import { type Env, ConfigError, openaiApiKey, requireEnv } from "../config/env";
import { requireModel } from "../config/models";
import { ALLOWED_ORIGINS } from "../auth/guard";

export const E164 = /^\+[1-9]\d{1,14}$/;
export const CALL_SID = /^CA[0-9a-f]{32}$/i;
export const CARRIER_CALLBACK_PATH = "/api/phone/twilio";

/** The URL Twilio signs must match the URL registered at dial time, including behind an HTTPS proxy. */
export function callbackOrigin(env: Env, requestOrigin?: string | null): string {
  const configured = env.FRANKI_PHONE_REPORT_ORIGIN;
  const candidate = configured || (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : "");
  const url = URL.parse(candidate);
  if (url?.protocol !== "https:" || url.origin !== candidate) throw new ConfigError("FRANKI_PHONE_REPORT_ORIGIN");
  return url.origin;
}

export function callbackUrl(origin: string, dialId: string): string {
  return origin + CARRIER_CALLBACK_PATH + "?dialId=" + encodeURIComponent(dialId);
}

export function phoneConfig(env: Env) {
  const account = requireEnv("TWILIO_ACCOUNT_SID", env);
  const token = requireEnv("TWILIO_AUTH_TOKEN", env);
  const from = requireEnv("TWILIO_PHONE_NUMBER", env);
  const project = requireEnv("OPENAI_PROJECT_ID", env);
  if (!/^AC[0-9a-f]{32}$/i.test(account)) throw new ConfigError("TWILIO_ACCOUNT_SID");
  if (!E164.test(from)) throw new ConfigError("TWILIO_PHONE_NUMBER");
  if (!/^proj_[A-Za-z0-9_-]+$/.test(project)) throw new ConfigError("OPENAI_PROJECT_ID");
  // Validate the answering leg before ringing someone's phone.
  openaiApiKey(env);
  requireEnv("OPENAI_WEBHOOK_SECRET", env);
  requireModel("voice", env);
  return { account, token, from, project };
}

export class DialRejected extends Error {}
export function dialConfig(env: Env, requestOrigin?: string | null) {
  return { ...phoneConfig(env), callbackOrigin: callbackOrigin(env, requestOrigin) };
}
export type Dial = (config: ReturnType<typeof dialConfig>, to: string, correlation: string) => Promise<string>;

export const dialTwilio: Dial = async ({ account, token, from, project, callbackOrigin }, to, correlation) => {
  // All values interpolated into XML are restricted identifiers. The opaque header identifies
  // this authorized attempt when OpenAI receives Twilio's SIP INVITE.
  const sip = `sip:${project}@sip.api.openai.com;transport=tls;secure=true?x-franki-call=${correlation}`;
  const twiml = `<Response><Dial callerId="${from}"><Sip>${sip}</Sip></Dial></Response>`;
  // Twilio consumes connection overrides itself. The URL it signs and sends excludes the fragment.
  const statusCallback = callbackUrl(callbackOrigin, correlation) + "#rt=5000&rc=2&rp=ct,rt,5xx";
  const form = new URLSearchParams({ To: to, From: from, Twiml: twiml, StatusCallback: statusCallback, StatusCallbackMethod: "POST" });
  for (const event of ["initiated", "ringing", "answered", "completed"]) form.append("StatusCallbackEvent", event);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}` },
    body: form,
    signal: AbortSignal.timeout(4000),
  });
  if (response.status >= 400 && response.status < 500) throw new DialRejected();
  if (!response.ok) throw new Error("Twilio call submission unconfirmed");
  const data = await response.json() as { sid?: unknown };
  if (typeof data.sid !== "string" || !CALL_SID.test(data.sid)) throw new Error("Missing Twilio call SID");
  return data.sid;
};
