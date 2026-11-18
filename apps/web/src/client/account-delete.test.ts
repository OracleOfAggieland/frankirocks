import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETE_PATH, createApiClient, deleteAccount } from "./api";

function client(status: number, body: unknown) {
  const sent: { path: string; init: RequestInit }[] = [];
  const api = createApiClient({
    getToken: async () => "id-token",
    fetch: async (path, init) => {
      sent.push({ path, init });
      return new Response(JSON.stringify(body), { status });
    },
  });
  return { api, sent };
}

describe("deleteAccount", () => {
  it("posts the words the route requires and is true only on the server's own answer", async () => {
    const ok = client(200, { deleted: true });
    expect(await deleteAccount(ok.api)).toBe(true);
    expect(ok.sent).toHaveLength(1);
    expect(ok.sent[0]!.path).toBe(ACCOUNT_DELETE_PATH);
    expect(ok.sent[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(ok.sent[0]!.init.body))).toEqual({ confirm: "delete everything" });
  });

  it("is false on an error or an answer of another shape", async () => {
    expect(await deleteAccount(client(503, { error: "DEPENDENCY" }).api)).toBe(false);
    expect(await deleteAccount(client(200, { deleted: "yes" }).api)).toBe(false);
  });

  it("sends nothing while signed out", async () => {
    const sent: unknown[] = [];
    const api = createApiClient({
      getToken: async () => null,
      fetch: async (p) => {
        sent.push(p);
        return new Response("{}");
      },
    });
    expect(await deleteAccount(api)).toBe(false);
    expect(sent).toEqual([]);
  });
});
