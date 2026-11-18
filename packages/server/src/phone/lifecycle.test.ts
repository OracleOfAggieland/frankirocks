import { Ledger, type PhoneReport, tsFromMs, validate } from "@franki/core";
import { testId } from "@franki/core/testing";
import { describe, expect, it } from "vitest";
import { cFields } from "../records";
import { PHONE_CARRIER_RETRY_MS, PHONE_REPORT_GRACE_MS, PHONE_SUBMISSION_WINDOW_MS, advanceCarrier, carrierOf, phoneCompletion, storedPhoneStatus, trackedPhonePayload } from "./lifecycle";
import type { PhoneEntry } from "./outbound";

const at = tsFromMs(0);
const legacy: PhoneEntry = {
  ...cFields("owner-1", at, 0, 0), kind: "phoneCall", at, state: "complete", retainUntil: null,
  payload: { sessionId: testId("session"), turnId: testId("turn"), twilioSid: "CA" + "a".repeat(32), realtimeCallId: null, accepted: false },
};
const report: PhoneReport = { outcome: "answered", summary: "The store closes at seven." };

describe("the carrier and specialist lifecycle for one dial", () => {
  it.each([legacy, { ...legacy, payload: { ...legacy.payload, phoneCallId: testId("dial") } }])(
    "accepts and upgrades the legacy payload",
    (row) => {
      expect(validate(Ledger, row).ok).toBe(true);
      expect(storedPhoneStatus(row, 0)).toBe("unknown");
      const tracked = advanceCarrier(row, "ringing", 10);
      expect(validate(Ledger, tracked).ok).toBe(true);
      expect(tracked.payload).toMatchObject({ ...row.payload, nextCarrierCheckAt: tsFromMs(10 + PHONE_CARRIER_RETRY_MS) });
      expect(storedPhoneStatus(tracked, 10)).toBe("ringing");
    },
  );

  it("ignores regressing and duplicate observations, including a poll racing the terminal callback", () => {
    const ringing = advanceCarrier(legacy, "ringing", 10);
    const pickedUp = advanceCarrier(ringing, "in-progress", 50);
    expect(trackedPhonePayload(pickedUp).nextCarrierCheckAt).toEqual(trackedPhonePayload(ringing).nextCarrierCheckAt);
    expect(advanceCarrier(pickedUp, "ringing", 75)).toBe(pickedUp);
    expect(storedPhoneStatus(pickedUp, 50)).toBe("ringing");
    expect(storedPhoneStatus({ ...pickedUp, payload: { ...pickedUp.payload, accepted: true } }, 50)).toBe("talking");
    const ended = advanceCarrier(pickedUp, "completed", 100);
    for (const status of ["in-progress", "completed", "busy", "queued"] as const) {
      expect(advanceCarrier(ended, status, 110)).toBe(ended);
    }
    expect(carrierOf(ended)?.observedAt).toBe(tsFromMs(100));
    expect(trackedPhonePayload(ended).nextCarrierCheckAt).toBeNull();
  });

  it("waits for hangup after an early report and for the grace deadline after an unreported hangup", () => {
    const active = advanceCarrier(legacy, "in-progress", 0);
    expect(phoneCompletion(active, report, 100)).toBe("active");
    const ended = advanceCarrier(active, "completed", 100);
    expect(phoneCompletion(ended, report, 100)).toBe("reported");
    const deadline = 100 + PHONE_REPORT_GRACE_MS;
    expect(phoneCompletion(ended, null, deadline - 1)).toBe("awaitingReport");
    expect(phoneCompletion(ended, null, deadline)).toBe("unconfirmed");
    expect(phoneCompletion(ended, report, deadline + 1)).toBe("reported");
  });

  it("settles unsuccessful calls immediately and keeps ambiguous submissions unknown", () => {
    for (const [carrier, completion] of [["busy", "busy"], ["no-answer", "noAnswer"], ["failed", "failed"], ["canceled", "failed"]] as const) {
      expect(phoneCompletion(advanceCarrier(legacy, carrier, 1), null, 1)).toBe(completion);
    }
    expect(phoneCompletion({ ...legacy, state: "blocked" }, null, 1)).toBe("unknown");
    expect(phoneCompletion({ ...legacy, state: "failed" }, null, 1)).toBe("failed");
  });

  it("times out a stranded dial claim until a carrier observation proves where it stands", () => {
    const pending: PhoneEntry = { ...legacy, state: "pending", payload: { ...legacy.payload, twilioSid: null } };
    const deadline = PHONE_SUBMISSION_WINDOW_MS;
    expect(storedPhoneStatus(pending, deadline - 1)).toBe("dialing");
    expect(storedPhoneStatus(pending, deadline)).toBe("unknown");
    expect(phoneCompletion(pending, null, deadline)).toBe("unknown");
    const confirmed = advanceCarrier(pending, "ringing", deadline + 20);
    expect(storedPhoneStatus(confirmed, deadline + 20)).toBe("ringing");
    expect(phoneCompletion(confirmed, null, deadline + 20)).toBe("active");
  });

  it("marks an exhausted carrier lookup unknown and still accepts a late hangup", () => {
    const active = advanceCarrier(legacy, "in-progress", 1);
    const expired = { ...active, payload: { ...trackedPhonePayload(active), nextCarrierCheckAt: null } };
    expect(phoneCompletion(expired, null, 50)).toBe("unknown");
    expect(advanceCarrier(expired, "ringing", 51)).toBe(expired);
    expect(storedPhoneStatus(advanceCarrier(expired, "completed", 52), 52)).toBe("ended");
  });
});
