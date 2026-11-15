// The live test recorder's route (brief 050). Development only: next.config.ts adds the `dev.ts` page extension
// only under `next dev`, so a production build has no /api/dev/live-test route, and the post-build check
// (scripts/specimens-absent.mjs) proves it. The Server_Library also refuses when NODE_ENV is production, and
// writes nothing unless FRANKI_LIVE_TEST_DIR is set.
//   GET                   whether the recorder is on, the run, line counts, the last write and the script
//   POST {"events":[…]}   append a batch of browser or runner events
import { liveTestDeps, liveTestStatus, postLiveTestEvents } from "@franki/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export function GET() {
  const r = liveTestStatus(liveTestDeps());
  return Response.json(r.body, { status: r.status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const length = request.headers.get("content-length");
  const r = await postLiveTestEvents(liveTestDeps(), {
    origin: request.headers.get("origin"),
    url: request.url,
    declaredBytes: length !== null && /^\d+$/.test(length) ? Number(length) : null,
    body: () => request.text(),
  });
  return Response.json(r.body, { status: r.status, headers: NO_STORE });
}
