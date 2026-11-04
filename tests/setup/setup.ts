// Vitest setup (R31.1, R31.2): every test runs with no network access.
// Any attempt throws an error that names the attempted access, so the test fails.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

export class NetworkBlockedError extends Error {
  constructor(what: string) {
    super(`Network access blocked in tests: ${what}. Use Fake_OpenAI and the Memory_Store instead.`);
    this.name = "NetworkBlockedError";
  }
}

function blocked(what: string) {
  return (..._args: unknown[]): never => {
    throw new NetworkBlockedError(what);
  };
}

globalThis.fetch = blocked("fetch") as typeof fetch;
if (typeof globalThis.WebSocket === "function") {
  globalThis.WebSocket = blocked("WebSocket") as unknown as typeof WebSocket;
}

Object.assign(http, { request: blocked("http.request"), get: blocked("http.get") });
Object.assign(https, { request: blocked("https.request"), get: blocked("https.get") });
Object.assign(net, { connect: blocked("net.connect"), createConnection: blocked("net.createConnection") });
Object.assign(tls, { connect: blocked("tls.connect") });

// Make named ESM imports (`import { connect } from "node:net"`) see the stubs too.
syncBuiltinESMExports();
