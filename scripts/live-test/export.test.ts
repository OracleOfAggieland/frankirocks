// Brief 050 part C: the export's logic on an in-memory fake of the Firestore reads. Never touches a real project.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT, repoFolderProblem } from "./lib/cli.mjs";
import { EVIDENCE_LEAD_MS, SEALED, WHOLE, collect, dotenvValue, redact, userIds, writeFiles } from "./lib/export.mjs";

const UID = "u-test-1";
const START = 1763159000000;
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Doc = { id: string; data: Record<string, unknown>; createTime: number | null; updateTime: number | null };

/** A read-only fake: a map from collection path to documents, and a log of every path listed. */
function fakeStore(collections: Record<string, Doc[]>) {
  const listed: string[] = [];
  const list = async (path: string) => {
    listed.push(path);
    return (collections[path] ?? []).map((d) => structuredClone(d));
  };
  return { list, listed };
}

const sealed = { v: 1, iv: "AAAAAAAAAAAAAAAA", body: "BBBBBBBBBBBBBBBBBBBBBBBB" };
const doc = (id: string, data: Record<string, unknown>, updateTime: number | null = START): Doc => ({ id, data, createTime: updateTime, updateTime });

describe("connector redaction", () => {
  it("replaces every sealed value and token field, and keeps the rest", () => {
    const bank = {
      provider: "plaid",
      state: "connected",
      cursor: { kind: "inline", text: "opaque" },
      quota: { nextAllowedAt: "2025-11-14T00:00:00.000Z", leaseToken: "lease-1", leaseUntil: null },
      bank: { itemId: "item-9", institutionName: "Test Bank", token: sealed, accounts: [{ accountId: "a1", name: "Checking", mask: "0000" }] },
      google: { email: "owner@example.test", token: null, pending: { stateHash: "h", verifier: sealed } },
    };
    const out = redact(bank, true) as typeof bank;
    expect(out.bank.token).toBe(SEALED);
    expect(out.google.pending.verifier).toBe(SEALED);
    expect(out.quota.leaseToken).toBe(SEALED);
    expect(out.cursor).toBe(SEALED);
    // A null token stays null: it says there is no token.
    expect(out.google.token).toBeNull();
    expect(out.bank.accounts[0]).toEqual({ accountId: "a1", name: "Checking", mask: "0000" });
    expect(out.state).toBe("connected");
    expect(JSON.stringify(out)).not.toMatch(/AAAAAAAA|BBBBBBBB|lease-1|opaque/);
  });

  it("replaces a sealed shape in any collection, without the key rule", () => {
    expect(redact({ a: [{ x: sealed }], leaseToken: "kept" })).toEqual({ a: [{ x: SEALED }], leaseToken: "kept" });
  });
});

describe("collect", () => {
  const root = `users/${UID}`;
  const store = () =>
    fakeStore({
      [`${root}/sessions`]: [doc("s1", { state: "open" })],
      [`${root}/sessions/s1/turns`]: [doc("t1", { role: "user", text: "made-up words" }), doc("t2", { role: "assistant", text: "made-up reply" })],
      [`${root}/ledger`]: [doc("l1", { kind: "request" })],
      [`${root}/evidence`]: [
        doc("e-new", { receivedAt: "2025-11-14T22:30:00.000Z" }, START + 1000),
        doc("e-edge", {}, START - EVIDENCE_LEAD_MS),
        doc("e-old", {}, START - EVIDENCE_LEAD_MS - 1),
        doc("e-notime", { receivedAt: "2025-11-14T22:23:00.000Z" }, null),
      ],
      [`${root}/connectors`]: [doc("plaid-1", { provider: "plaid", bank: { token: sealed } })],
      ["users/someone-else/ledger"]: [doc("x", { kind: "request" })],
    });

  it("reads only the user's own paths, and writes sessions with their turns", async () => {
    const { list, listed } = store();
    const { files, counts } = await collect({ list, uid: UID, since: START });
    expect(listed.every((p) => p.startsWith(`${root}/`))).toBe(true);
    for (const name of WHOLE) expect(listed).toContain(`${root}/${name}`);
    expect(listed).toContain(`${root}/sessions/s1/turns`);
    expect(counts).toMatchObject({ sessions: 1, turns: 2, ledger: 1, connectors: 1, jobs: 0 });
    expect(files.turns.docs.map((d: { id: string; sessionId: string }) => [d.id, d.sessionId])).toEqual([
      ["t1", "s1"],
      ["t2", "s1"],
    ]);
    expect(files.connectors.docs[0].data.bank.token).toBe(SEALED);
  });

  it("keeps evidence changed since five minutes before the start, and counts the rest", async () => {
    const { list } = store();
    const { files, counts } = await collect({ list, uid: UID, since: START });
    // e-notime has no document time; its receivedAt (22:23:00, within the window) decides.
    expect(files.evidence.docs.map((d: { id: string }) => d.id).sort()).toEqual(["e-edge", "e-new", "e-notime"]);
    expect(counts.evidenceOlder).toBe(1);
    expect(files.evidence.older).toBe(1);
  });

  it("refuses a user ID that would leave the tenant root", async () => {
    const { list } = store();
    await expect(collect({ list, uid: "a/b", since: START })).rejects.toThrow();
    await expect(collect({ list, uid: "", since: START })).rejects.toThrow();
  });

  it("writes one file per collection and an index of counts", async () => {
    const { list } = store();
    const dir = mkdtempSync(join(tmpdir(), "franki-live-export-"));
    temps.push(dir);
    writeFiles(dir, UID, await collect({ list, uid: UID, since: START }), "2025-11-14T23:00:00.000Z");
    const index = JSON.parse(readFileSync(join(dir, "firestore", "index.json"), "utf8"));
    expect(index.counts.turns).toBe(2);
    expect(JSON.stringify(index)).not.toContain("made-up");
    const connectors = readFileSync(join(dir, "firestore", "connectors.json"), "utf8");
    expect(connectors).not.toContain("BBBBBBBB");
  });
});

describe("user IDs from the run", () => {
  it("takes distinct signed-in IDs in order and ignores empty ones", () => {
    const ev = (uid: unknown) => ({ t: 1, src: "client", kind: "user", uid });
    expect(userIds([ev("a"), ev(""), ev(null), ev("b"), ev("a"), { t: 2, kind: "route.done", uid: "c" }])).toEqual(["a", "b"]);
  });
});

describe("the repo-folder refusal", () => {
  it("refuses the repo and folders in it, and allows .live-test/<run> and folders outside", () => {
    expect(repoFolderProblem(REPO_ROOT)).toMatch(/refusing/);
    expect(repoFolderProblem(join(REPO_ROOT, "scripts", "live-test", "fixtures", "basic"))).toMatch(/refusing/);
    expect(repoFolderProblem(join(REPO_ROOT, ".live-test"))).toMatch(/refusing/);
    expect(repoFolderProblem(join(REPO_ROOT, ".live-test", "2025-11-14_222320"))).toBeNull();
    expect(repoFolderProblem(join(REPO_ROOT, "..", "elsewhere"))).toBeNull();
  });

  it("compares case-blind on Windows", () => {
    const upper = join(REPO_ROOT.toUpperCase(), "docs");
    expect(repoFolderProblem(upper, REPO_ROOT, "win32")).toMatch(/refusing/);
  });

  it("is not fooled by a sibling folder that starts with the repo's name", () => {
    const dir = mkdtempSync(join(tmpdir(), "franki-sibling-"));
    temps.push(dir);
    mkdirSync(join(dir, "repo"));
    mkdirSync(join(dir, "repo-runs"));
    expect(repoFolderProblem(join(dir, "repo-runs"), join(dir, "repo"))).toBeNull();
  });
});

describe("the project ID", () => {
  it("reads one key from a dotenv file", () => {
    expect(dotenvValue("A=1\nFRANKI_FIREBASE_PROJECT_ID=\"demo-x\"\nB=2\n", "FRANKI_FIREBASE_PROJECT_ID")).toBe("demo-x");
    expect(dotenvValue("FRANKI_FIREBASE_PROJECT_ID=\n", "FRANKI_FIREBASE_PROJECT_ID")).toBeNull();
  });
});
