import { SMOKE } from "@franki/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";
import type { HealthDeps } from "./health";

/** Health dependencies backed by the real Firestore and OpenAI. Server-only. */
export function createLiveHealthDeps(apiKey: string | undefined = process.env.OPENAI_API_KEY): HealthDeps {
  // With no arguments, the Admin SDK picks up the project and credentials App Hosting provides.
  if (getApps().length === 0) initializeApp();
  const db = getFirestore();
  const openai = new OpenAI({ apiKey });
  const smoke = db.collection(SMOKE.collection);

  return {
    now: () => Date.now(),

    async firestoreRoundTrip() {
      const ref = smoke.doc(SMOKE.webDoc);
      const nonce = crypto.randomUUID();
      await ref.set({ nonce, at: FieldValue.serverTimestamp() });
      return (await ref.get()).get("nonce") === nonce;
    },

    async retrieveModel(model) {
      return (await openai.models.retrieve(model)).id;
    },

    async mintRealtimeClientSecret(model) {
      const secret = await openai.realtime.clientSecrets.create({
        expires_after: { anchor: "created_at", seconds: 10 },
        session: { type: "realtime", model },
      });
      return secret.value;
    },

    async readHeartbeat() {
      const snap = await smoke.doc(SMOKE.heartbeatDoc).get();
      if (!snap.exists) return null;
      const at: unknown = snap.get("at");
      return {
        atMs: at instanceof Timestamp ? at.toMillis() : Number.NaN,
        openaiOk: snap.get("openaiOk") === true,
        kmsOk: snap.get("kmsOk") === true,
      };
    },
  };
}
