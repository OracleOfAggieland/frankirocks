import { SMOKE } from "@franki/core";
import { reconcileDuePhoneCalls } from "@franki/server/phone-reconciliation";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger, setGlobalOptions } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import OpenAI from "openai";
import { opsNowMs } from "./clock";

setGlobalOptions({
  region: "us-central1",
  // Only this service account may use the limb-token key, so the web backend can never decrypt tokens.
  // Spelled out in full: the CLI's secret-access step rejects the "name@" shorthand.
  serviceAccount: "franki-functions@frankirocks.iam.gserviceaccount.com",
  maxInstances: 2,
});

initializeApp();

const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const BG_MODEL = defineString("FRANKI_BG_MODEL");
const LIMB_TOKENS_KEY = defineString("FRANKI_LIMB_TOKENS_KEY");
const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const FRANKI_ID_HMAC_KEY = defineSecret("FRANKI_ID_HMAC_KEY");

/** Recovers a missed carrier callback even after the original browser conversation closes. */
export const reconcilePhoneCalls = onSchedule(
  { schedule: "* * * * *", secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, FRANKI_ID_HMAC_KEY], maxInstances: 1, timeoutSeconds: 120 },
  async () => {
    const counts = await reconcileDuePhoneCalls(getFirestore(), {
      account: TWILIO_ACCOUNT_SID.value(), token: TWILIO_AUTH_TOKEN.value(), hmacKey: FRANKI_ID_HMAC_KEY.value(),
    }, opsNowMs);
    if (counts.failed || counts.unavailable) logger.warn("Phone status reconciliation incomplete", counts);
  },
);

/** Proves the scheduler, Secret Manager, OpenAI, Cloud KMS and Firestore are wired. Read by /api/health. */
export const heartbeat = onSchedule(
  { schedule: "every 30 minutes", secrets: [OPENAI_API_KEY], maxInstances: 1, timeoutSeconds: 60 },
  async () => {
    const [openaiOk, kmsOk] = await Promise.all([checkOpenAI(), checkKms()]);
    await getFirestore()
      .collection(SMOKE.collection)
      .doc(SMOKE.heartbeatDoc)
      .set({ at: FieldValue.serverTimestamp(), openaiOk, kmsOk, node: process.version });
    logger.info("heartbeat", { openaiOk, kmsOk });
  },
);

async function checkOpenAI(): Promise<boolean> {
  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
    return (await openai.models.retrieve(BG_MODEL.value())).id === BG_MODEL.value();
  } catch (error) {
    logger.warn("heartbeat: OpenAI check failed", { status: (error as { status?: number }).status });
    return false;
  }
}

async function checkKms(): Promise<boolean> {
  try {
    const kms = new KeyManagementServiceClient();
    const plaintext = Buffer.from(`heartbeat:${opsNowMs()}`);
    const [encrypted] = await kms.encrypt({ name: LIMB_TOKENS_KEY.value(), plaintext });
    const [decrypted] = await kms.decrypt({ name: LIMB_TOKENS_KEY.value(), ciphertext: encrypted.ciphertext });
    return Buffer.from(decrypted.plaintext ?? []).equals(plaintext);
  } catch (error) {
    logger.warn("heartbeat: KMS check failed", { code: (error as { code?: number }).code });
    return false;
  }
}
