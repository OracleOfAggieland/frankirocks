import { bankConnectRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Exchanges Plaid Link's public token and saves the bank connection, with a ledger row. */
export const POST = adapt(bankConnectRoute);
