import { phoneReportEndpoint } from "@franki/server";

export const runtime = "nodejs";
export function POST(request: Request) {
  return phoneReportEndpoint(request);
}
