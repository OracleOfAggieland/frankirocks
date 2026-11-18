import { arr, bool, literal, nullable, obj, oneOf, str, type Infer } from "./schema/v";
import { WebCitation } from "./web-citation";

export const WEB_SEARCH_STATES = ["none", "searching", "found", "unverified", "unavailable"] as const;
export type WebSearchStatus = (typeof WEB_SEARCH_STATES)[number];
export const webSearchStateShape = { status: oneOf(WEB_SEARCH_STATES) };
export const WebSearchArgs = obj({ query: str(600, { min: 1 }), local: bool, location: nullable(str(120, { min: 1 })) });
export type WebSearchArgs = Infer<typeof WebSearchArgs>;
export const WebFinding = obj({
  text: str(512, { min: 1 }),
  sources: arr(WebCitation, 2, 1),
});
export const StartWebSearch = obj({ name: literal("search_web"), args: WebSearchArgs });
export const ReadWebSearch = obj({ name: literal("read_web_result"), args: obj({}) });

export const WEB_SEARCH_TOOL = {
  type: "function", name: "search_web",
  description: "Use the public web specialist for facts you cannot confidently answer, current information, or nearby restaurants and public events. Use only the public question from the recent user's own words. For nearby requests ask for a city or neighborhood if missing. The search runs in the background. Continue the conversation normally.",
  parameters: { type: "object", additionalProperties: false, required: ["query", "local", "location"], properties: {
    query: { type: "string", description: "Quote the shortest relevant phrase in the owner's question, leaving out private details. To resolve a follow-up like 'Is it open tomorrow?', prefix the short public place or subject the owner previously named, e.g. 'City Gallery open tomorrow'. Up to 600 characters." },
    local: { type: "boolean", description: "True if the answer depends on where to search." },
    location: { type: ["string", "null"], description: "City, neighborhood, or postal code supplied by the user in this conversation. Never use an exact address or infer a location from their time zone. Null if irrelevant or unknown." },
  } },
} as const;

export const READ_WEB_TOOL = {
  type: "function", name: "read_web_result",
  description: "Read the latest web specialist result when it answers the owner's current question or they ask about a previous search. Read this before starting the same search again. Cite the source by name, using only the returned findings.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
} as const;

export function webSearchInstruction(status: WebSearchStatus | null | undefined): string {
  if (!status || status === "none") return "";
  if (status === "searching") return "\nA web search is running in the background. Continue answering the user's current turn. If they ask about the lookup, say it is in progress.";
  return "\nThe web specialist finished its latest search. If its result is relevant to the current turn, use read_web_result before answering. Follow the user's current topic.";
}
