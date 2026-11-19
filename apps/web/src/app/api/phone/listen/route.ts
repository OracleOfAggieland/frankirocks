import { phoneListenEndpoint } from "@franki/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The listener stays on an answered call inside this request. It hangs up before Cloud Run's 300 s timeout.
export const maxDuration = 300;

export function POST(request: Request) {
  return phoneListenEndpoint(request);
}
