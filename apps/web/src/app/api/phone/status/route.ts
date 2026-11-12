import { phoneStatusRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Where the phone call one of the signed-in user's turns placed stands, for the phone on the screen. Read-only. */
export const GET = adapt(phoneStatusRoute);
