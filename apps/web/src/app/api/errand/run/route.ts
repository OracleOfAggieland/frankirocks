/**
 * POST /api/errand/run: runs one Errand claim inside this request, so Cloud Run keeps the CPU on while it works
 * (owner ruling, Nov 19; `packages/server/src/errands/hand-off.ts`). Only the app itself calls it, with a signed
 * capability; it is not behind the Firebase Route_Guard.
 */
import { errandRunEndpoint } from "@franki/server";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return errandRunEndpoint(request, (work) => after(work));
}
