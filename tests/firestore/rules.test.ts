/**
 * Firestore rules stay deny-all (R8.2–R8.5, R8.8). Emulator only: run with `npm run test:emulator` (CI, Java 21).
 * Loads the repository's firestore.rules file itself.
 */
import { readFileSync } from "node:fs";
import {
  type RulesTestContext,
  type RulesTestEnvironment,
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  type Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

let env: RulesTestEnvironment;

/** The test context returns the compat Firestore type; the modular functions accept it at runtime. */
const modular = (ctx: RulesTestContext): Firestore => ctx.firestore() as unknown as Firestore;

const ID = "a".repeat(43);
/** Collection paths (relative to a Tenant_Root) and one document in each. */
const TENANT_COLLECTIONS = ["evidence", "memories", "sessions", `sessions/${ID}/turns`, "core", "jobs", "ledger"];
const docIn = (col: string) => `${col}/${col === "core" ? "epoch" : ID}`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-franki",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
  // Seed every target so update and delete are judged by the rules, not by a missing document.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = modular(ctx);
    for (const uid of ["A", "B"]) {
      await setDoc(doc(db, `users/${uid}`), { seeded: true });
      for (const col of TENANT_COLLECTIONS) await setDoc(doc(db, `users/${uid}/${docIn(col)}`), { seeded: true });
    }
    await setDoc(doc(db, "_smoke/web"), { seeded: true });
  });
});

afterAll(async () => {
  await env?.cleanup();
});

/** Fails with the operation, path and auth state when the rules allow the call (R8.8). */
async function denied(op: string, path: string, auth: string, attempt: () => Promise<unknown>): Promise<void> {
  try {
    await assertFails(attempt());
  } catch {
    throw new Error(`Firestore rules ALLOWED ${op} on ${path} for ${auth}`);
  }
}

async function expectAllDenied(db: Firestore, docPath: string, colPath: string, auth: string): Promise<void> {
  await denied("get", docPath, auth, () => getDoc(doc(db, docPath)));
  await denied("list", colPath, auth, () => getDocs(collection(db, colPath)));
  await denied("create", `${colPath}/${"n".repeat(43)}`, auth, () => setDoc(doc(db, `${colPath}/${"n".repeat(43)}`), { x: 1 }));
  await denied("update", docPath, auth, () => updateDoc(doc(db, docPath), { x: 2 }));
  await denied("delete", docPath, auth, () => deleteDoc(doc(db, docPath)));
}

describe("firestore.rules deny every client read and write", () => {
  it("own uid: every in-scope collection and the Tenant_Root document (R8.3)", async () => {
    const db = modular(env.authenticatedContext("A"));
    for (const col of TENANT_COLLECTIONS) await expectAllDenied(db, `users/A/${docIn(col)}`, `users/A/${col}`, "own uid A");
    await expectAllDenied(db, "users/A", "users", "own uid A");
  });

  it("another Owner's Tenant_Root (R8.4)", async () => {
    const db = modular(env.authenticatedContext("A"));
    for (const col of TENANT_COLLECTIONS) await expectAllDenied(db, `users/B/${docIn(col)}`, `users/B/${col}`, "other uid A→B");
    await expectAllDenied(db, "users/B", "users", "other uid A→B");
  });

  it("unauthenticated: a Tenant_Root document and a top-level path (R8.5)", async () => {
    const db = modular(env.unauthenticatedContext());
    await expectAllDenied(db, `users/A/${docIn("memories")}`, "users/A/memories", "unauthenticated");
    await expectAllDenied(db, "users/A", "users", "unauthenticated");
    await expectAllDenied(db, "_smoke/web", "_smoke", "unauthenticated");
  });
});
