import { googleDisconnectRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Revokes the grant at Google and erases the connection, with a ledger row. */
export const POST = adapt(googleDisconnectRoute);
