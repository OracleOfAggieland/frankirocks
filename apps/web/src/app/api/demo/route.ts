import { demoStatus } from "@franki/server";

export const dynamic = "force-dynamic";

/**
 * Brief 054 (R15.8): whether the Kiroween Demo is on, so the page knows whether to show its button before anyone is
 * signed in. Public like /api/health, and answers one boolean: no tenant, no auth, nothing else.
 */
export function GET() {
  return Response.json(demoStatus(process.env), { headers: { "cache-control": "no-store" } });
}
