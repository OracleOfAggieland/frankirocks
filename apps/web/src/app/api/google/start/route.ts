import { googleStartRoute } from "@franki/server";
import { adapt } from "../../_lib/adapter";

export const dynamic = "force-dynamic";

/** Stores one pending authorization (state hash, sealed PKCE verifier, redirect URI) and answers Google's URL. */
export const POST = adapt(googleStartRoute);
