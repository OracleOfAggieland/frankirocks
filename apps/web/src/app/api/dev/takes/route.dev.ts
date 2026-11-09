// The owner's takes for the judge spike (brief 006 item 3). Development only: next.config.ts adds the `dev.ts`
// page extension only under `next dev`, so a production build has no /api/dev/takes route, and the post-build
// check (scripts/specimens-absent.mjs) proves it. The Server_Library also refuses when NODE_ENV is production.
//   GET                      the lines and which have a take
//   PUT ?line=<id>, WAV body  save one take, overwriting a retake
import { listTakes, liveTakesDeps, saveTake } from "@franki/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export function GET() {
  const r = listTakes(liveTakesDeps());
  return Response.json(r.body, { status: r.status, headers: NO_STORE });
}

export async function PUT(request: Request) {
  const length = request.headers.get("content-length");
  const r = await saveTake(liveTakesDeps(), {
    lineId: new URL(request.url).searchParams.get("line"),
    origin: request.headers.get("origin"),
    url: request.url,
    declaredBytes: length !== null && /^\d+$/.test(length) ? Number(length) : null,
    body: async () => new Uint8Array(await request.arrayBuffer()),
  });
  return Response.json(r.body, { status: r.status, headers: NO_STORE });
}
