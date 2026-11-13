import { bankStatusRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** The signed-in user's connected banks, as the screen may show them. Reads Firestore only. */
export const GET = adapt(bankStatusRoute);
