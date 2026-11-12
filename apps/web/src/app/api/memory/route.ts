import { memoryRoute } from "@franki/server";
import { adapt } from "../_lib/adapter";

export const dynamic = "force-dynamic";

/** What the screen may show about memory: the jar, the Lab, the strip, the receipt and the readout (brief 020). */
export const GET = adapt(memoryRoute);
