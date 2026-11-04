/**
 * Store_Port conformance against the Firestore_Store on the emulator (R7.2, R7.3, R7.9). Emulator only: run with
 * `npm run test:emulator`, which sets FIRESTORE_EMULATOR_HOST and the demo-franki project. Same suite as the
 * Memory_Store run in `npm test`.
 */
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll } from "vitest";
import { createHasher } from "../../packages/server/src/crypto";
import { storeConformance } from "../../packages/server/src/store/conformance";
import { FirestoreStore } from "../../packages/server/src/store/firestore-store";

const PROJECT = "demo-franki";
const FAKE_KEY = "test-only-franki-id-hmac-key-0000000000000";
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host === undefined) throw new Error("FIRESTORE_EMULATOR_HOST is not set; run through npm run test:emulator");

const app: App = initializeApp({ projectId: PROJECT }, "store-conformance");
const db = getFirestore(app);

afterAll(async () => {
  await deleteApp(app);
});

/** Clears the emulator database between tests (emulator-only REST endpoint). */
async function clearEmulator(): Promise<void> {
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`emulator clear failed: ${res.status}`);
}

storeConformance("Firestore_Store (emulator)", async () => {
  await clearEmulator();
  const hasher = createHasher(FAKE_KEY);
  return { store: new FirestoreStore(db, hasher), hasher };
});
