import { accountDeleteRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Removes connected banks at Plaid, revokes Google, then deletes every stored record and the sign-in. */
export const POST = adapt(accountDeleteRoute);
