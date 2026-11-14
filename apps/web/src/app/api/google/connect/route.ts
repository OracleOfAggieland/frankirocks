import { googleConnectRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Consumes the pending authorization, exchanges the code once, and saves the read-only connection, with a ledger row. */
export const POST = adapt(googleConnectRoute);
