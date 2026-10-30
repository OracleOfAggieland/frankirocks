import { createLiveHealthDeps, isSmokeAuthorized, runDeepHealth } from "@franki/server";

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
      brainModel: process.env.FRANKI_BRAIN_MODEL ?? null,
      voiceModel: process.env.FRANKI_VOICE_MODEL ?? null,
    },
  });
}

/** Deep check for the deploy smoke test: Firestore, OpenAI, Realtime minting and the heartbeat function. */
export async function POST(request: Request) {
  if (!isSmokeAuthorized(request.headers.get("authorization"), process.env.SMOKE_TOKEN)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const report = await runDeepHealth(createLiveHealthDeps(), {
    brainModel: process.env.FRANKI_BRAIN_MODEL ?? "gpt-6.1-terra",
    voiceModel: process.env.FRANKI_VOICE_MODEL ?? "gpt-realtime-2.1",
  });
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
