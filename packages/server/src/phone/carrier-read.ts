/** Look up one existing parent call when a carrier callback is missing. */
export type CallStatus = (config: { account: string; token: string }, sid: string) => Promise<string>;

export const twilioCallStatus: CallStatus = async ({ account, token }, sid) => {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls/${sid}.json`, {
    method: "GET",
    redirect: "error",
    headers: { Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("Twilio call status unavailable");
  const data = (await response.json()) as { status?: unknown };
  if (typeof data.status !== "string") throw new Error("Missing Twilio call status");
  return data.status;
};
