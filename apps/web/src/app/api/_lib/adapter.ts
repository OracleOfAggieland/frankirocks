/**
 * The route adapter template (R5.4; design "Background work"). Every API route handler is
 * `export const POST = adapt(someRoute)`: convert the Request, run the Server_Library route on the live deps, and
 * return its JSON. `schedule` is backed by `after()` from next/server, so background work (extraction, tick,
 * drains) runs after the response is sent. `_lib` is a private folder, so Next does not route it.
 */
import { type RouteSpec, runLiveRoute } from "@franki/server";
import { after } from "next/server";

export function adapt<Req>(spec: RouteSpec<Req>) {
  return async function handler(request: Request): Promise<Response> {
    const result = await runLiveRoute(
      spec,
      {
        method: request.method,
        url: request.url,
        header: (name) => request.headers.get(name),
        text: () => request.text(),
      },
      (work) => after(work),
    );
    return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
  };
}
