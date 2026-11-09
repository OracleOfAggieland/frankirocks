import { configuredModels, createLiveHealthDeps, healthModels, isSmokeAuthorized, runDeepHealth } from "@franki/server";

export const dynamic = "force-dynamic";

/** Public liveness probe. Reports whether config is present, never its values. */
export function GET() {
  return Response.json({
    ok: true,
    service: "franki-web",
    node: process.version,
    configured: {
      openaiKey: Boolean(process.env.OPENAI_API_KEY),
      smokeToken: Boolean(process.env.SMOKE_TOKEN),
      ...configuredModels(),
    },
  });
}

/** Deep check for the deploy smoke test: Firestore, OpenAI, Realtime minting and the heartbeat function. */
export async function POST(request: Request) {
  if (!isSmokeAuthorized(request.headers.get("authorization"), process.env.SMOKE_TOKEN)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const report = await runDeepHealth(createLiveHealthDeps(), healthModels());
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
