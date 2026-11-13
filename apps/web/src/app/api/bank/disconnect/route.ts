import { bankDisconnectRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Removes the bank at Plaid, erases its token and marks it disconnected, with a ledger row. */
export const POST = adapt(bankDisconnectRoute);
