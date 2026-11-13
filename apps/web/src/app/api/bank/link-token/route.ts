import { bankLinkTokenRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** A Plaid Link token for connecting a bank (read-only, transactions only). 409 LIMIT at the bank limit. */
export const POST = adapt(bankLinkTokenRoute);
