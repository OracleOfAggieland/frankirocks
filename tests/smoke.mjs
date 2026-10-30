// Deploy smoke test against the live App Hosting backend. It mints a 10-second Realtime
// client secret but never opens a voice session, so it spends no audio minutes.
//   npm run smoke   (reads SMOKE_TOKEN from Secret Manager with your gcloud login unless it's set)
import { execSync } from "node:child_process";

function tokenFromSecretManager() {
  try {
    return execSync("gcloud secrets versions access latest --secret=SMOKE_TOKEN --project=frankirocks", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch {
    return "";
  }
}

const base = (process.env.FRANKI_URL ?? "https://franki-web--frankirocks.us-central1.hosted.app").replace(/\/$/, "");
const token = process.env.SMOKE_TOKEN || tokenFromSecretManager();
if (!token) {
  console.error("SMOKE_TOKEN is not set, and gcloud couldn't read it from Secret Manager.");
  process.exit(2);
}

const live = await fetch(`${base}/api/health`, { cache: "no-store" });
const liveBody = await live.json().catch(() => null);
console.log(`GET  ${base}/api/health -> ${live.status}`, JSON.stringify(liveBody));

const deep = await fetch(`${base}/api/health`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
const deepBody = await deep.json().catch(() => null);
console.log(`POST ${base}/api/health -> ${deep.status}`);
for (const [name, check] of Object.entries(deepBody?.checks ?? {})) {
  const status = check.ok ? "PASS" : "FAIL";
  console.log(`  ${status} ${name.padEnd(13)} ${String(check.ms).padStart(5)} ms  ${check.detail ?? ""}`);
}

const passed = live.ok && liveBody?.ok === true && deep.ok && deepBody?.ok === true;
console.log(passed ? "Smoke test passed." : "Smoke test FAILED.");
process.exit(passed ? 0 : 1);
