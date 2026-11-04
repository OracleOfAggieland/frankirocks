import * as http from "node:http";
import * as https from "node:https";
import { connect, createConnection } from "node:net";
import * as tls from "node:tls";
import { describe, expect, it } from "vitest";

describe("no-network test harness", () => {
  it("fetch throws", () => {
    expect(() => fetch("https://api.openai.com/v1/models")).toThrow(/Network access blocked in tests: fetch/);
  });

  it("net.connect throws", () => {
    expect(() => connect(443, "api.openai.com")).toThrow(/net\.connect/);
    expect(() => createConnection(443, "api.openai.com")).toThrow(/net\.createConnection/);
  });

  it("http, https and tls throw", () => {
    expect(() => http.request("http://example.com")).toThrow(/http\.request/);
    expect(() => http.get("http://example.com")).toThrow(/http\.get/);
    expect(() => https.request("https://example.com")).toThrow(/https\.request/);
    expect(() => https.get("https://example.com")).toThrow(/https\.get/);
    expect(() => tls.connect(443, "example.com")).toThrow(/tls\.connect/);
  });
});
