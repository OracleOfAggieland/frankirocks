import { bankSyncRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Pulls one connected bank's transactions once, or answers at once when a pull is already running. */
export const POST = adapt(bankSyncRoute);
