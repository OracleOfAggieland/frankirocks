import { timingSafeEqual } from "node:crypto";
import { PHONE_OUTCOMES, PHONE_SUMMARY_CHARS, PhoneReport, isIdShape, isPlainObject, validate } from "@franki/core";
import { ALLOWED_ORIGINS } from "../auth/guard";
import { liveRouteDeps } from "../routes/live-deps";
import type { RouteDeps } from "../routes/runtime";
import { phoneTransaction } from "./outbound";
import { PHONE_REPORT_WINDOW_MS, savePhoneReport } from "./report";

const TOOL = "report_call_outcome";
const BODY_LIMIT = 8192;
const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const spec = {
  name: TOOL, description: "Send the owner one final factual answer about this assignment.",
  inputSchema: { type: "object", required: ["outcome", "summary"], additionalProperties: false, properties: {
    outcome: { type: "string", enum: PHONE_OUTCOMES }, summary: { type: "string", minLength: 1, maxLength: PHONE_SUMMARY_CHARS },
  } },
};

interface Binding { uid: string; dialId: string; callId: string; until: number }

/** Credentials stay in transport headers. The model never supplies the call identity. */
export function reportTool(deps: RouteDeps, uid: string, dialId: string, callId: string, origin: string) {
  // Never send a capability to an origin supplied by an untrusted Host header.
  const publicOrigin = deps.env.FRANKI_PHONE_REPORT_ORIGIN || (ALLOWED_ORIGINS.includes(origin) && origin.startsWith("https:") ? origin : null);
  if (!publicOrigin) return null;
  const url = new URL(publicOrigin);
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== publicOrigin) throw new Error("Invalid phone report origin");
  const binding: Binding = { uid, dialId, callId, until: deps.clock.read().opsClock.now + PHONE_REPORT_WINDOW_MS };
  const body = Buffer.from(JSON.stringify(binding)).toString("base64url");
  const proof = deps.hasher.id(["phone-report-capability", body]);
  return {
    type: "mcp" as const, server_label: "phone_results", server_url: url.origin + "/api/phone/report",
    headers: { Authorization: `Bearer ${body}.${proof}` }, allowed_tools: [TOOL], require_approval: "never" as const,
  };
}

function bindingFor(deps: RouteDeps, header: string): Binding | null {
  const match = /^Bearer ([\w-]{1,1200})\.([\w-]{43})$/.exec(header);
  if (!match) return null;
  const expected = deps.hasher.id(["phone-report-capability", match[1]]);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]!))) return null;
  try {
    const b = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")) as Binding;
    return b && typeof b.uid === "string" && typeof b.callId === "string" && isIdShape(b.dialId) &&
      Number.isSafeInteger(b.until) && b.until > deps.clock.read().opsClock.now ? b : null;
  } catch { return null; }
}

/** Stateless Streamable HTTP MCP. The tool remains available after the greeting websocket detaches. */
export async function phoneReportEndpoint(request: Request, deps: RouteDeps = liveRouteDeps()): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const binding = bindingFor(deps, request.headers.get("authorization") ?? "");
  if (!binding) return new Response(null, { status: 401 });
  if (Number(request.headers.get("content-length")) > BODY_LIMIT) return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > BODY_LIMIT) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  let msg: unknown;
  try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return new Response(null, { status: 400 }); }
  if (!isPlainObject(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return new Response(null, { status: 400 });
  if (!("id" in msg) && msg.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  const id = msg.id;
  if (typeof id !== "string" && !Number.isSafeInteger(id)) return new Response(null, { status: 400 });
  const result = (value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value });
  const error = (code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });
  const params = isPlainObject(msg.params) ? msg.params : {};
  switch (msg.method) {
    case "initialize":
      return result({ protocolVersion: versions.includes(String(params.protocolVersion)) ? params.protocolVersion : versions[0],
        capabilities: { tools: {} }, serverInfo: { name: "franki-phone-results", version: "1" } });
    case "ping": return result({});
    case "tools/list": return result({ tools: [spec] });
    case "tools/call": {
      if (params.name !== TOOL) return error(-32602, "Unknown tool");
      const args = validate(PhoneReport, params.arguments);
      if (!args.ok || !args.value.summary.trim()) return error(-32602, "Invalid phone report");
      const report = { ...args.value, summary: args.value.summary.trim() };
      const saved = await phoneTransaction(deps.store, binding.uid, (tx) => savePhoneReport(tx, deps, binding.uid, binding.dialId, binding.callId, report));
      return result({ isError: !saved, content: [{ type: "text", text: saved ? "Report received." : "This assignment cannot receive that report." }] });
    }
    default: return error(-32601, "Method not found");
  }
}
