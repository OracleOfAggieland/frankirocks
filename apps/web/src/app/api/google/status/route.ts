import { googleStatusRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** The signed-in user's Google connection, as the screen may show it. Reads Firestore only. */
export const GET = adapt(googleStatusRoute);
