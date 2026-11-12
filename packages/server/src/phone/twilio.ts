import { type Env, ConfigError, openaiApiKey, requireEnv } from "../config/env";
import { requireModel } from "../config/models";

export const E164 = /^\+[1-9]\d{1,14}$/;

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
export type Dial = (config: ReturnType<typeof phoneConfig>, to: string, correlation: string) => Promise<string>;

export const dialTwilio: Dial = async ({ account, token, from, project }, to, correlation) => {
  // All values interpolated into XML are restricted identifiers. The opaque header identifies
  // this authorized attempt when OpenAI receives Twilio's SIP INVITE.
  const sip = `sip:${project}@sip.api.openai.com;transport=tls;secure=true?x-franki-call=${correlation}`;
  const twiml = `<Response><Dial callerId="${from}"><Sip>${sip}</Sip></Dial></Response>`;
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}` },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }),
    signal: AbortSignal.timeout(4000),
  });
  if (response.status >= 400 && response.status < 500) throw new DialRejected();
  if (!response.ok) throw new Error("Twilio call submission unconfirmed");
  const data = await response.json() as { sid?: unknown };
  if (typeof data.sid !== "string" || !/^CA[0-9a-f]{32}$/i.test(data.sid)) throw new Error("Missing Twilio call SID");
  return data.sid;
};
