import { debugMemoryRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Development-only debug data for the Debug_Panel; the Server_Library refuses it in production. */
export const GET = adapt(debugMemoryRoute);
