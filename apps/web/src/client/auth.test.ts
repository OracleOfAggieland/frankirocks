import { describe, expect, it } from "vitest";
import { SIGN_IN_MESSAGES, providerDetail, signInFailure } from "./auth";
import { readFirebaseConfig } from "./firebase-config";

describe("sign-in failure causes (R9.6)", () => {
  it.each([
    ["auth/popup-closed-by-user", "popupClosed"],
    ["auth/cancelled-popup-request", "popupClosed"],
    ["auth/user-cancelled", "popupClosed"],
    ["auth/popup-blocked", "popupBlocked"],
    ["auth/unauthorized-domain", "providerError"],
    ["auth/internal-error", "providerError"],
    [undefined, "providerError"],
  ])("%s → %s", (code, cause) => {
    expect(signInFailure(code)).toBe(cause);
  });

  it("each cause has its own message, and unauthorized-domain is named", () => {
    expect(new Set(Object.values(SIGN_IN_MESSAGES)).size).toBe(3);
    expect(providerDetail("auth/unauthorized-domain")).toMatch(/not an authorized domain/);
    expect(providerDetail({ token: "x" })).toBeNull();
  });
});

describe("public Firebase config", () => {
  const full = {
    NEXT_PUBLIC_FIREBASE_API_KEY: "k",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "d",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p",
    NEXT_PUBLIC_FIREBASE_APP_ID: "a",
  };

  it("builds the config from the four variables", () => {
    expect(readFirebaseConfig(full)).toEqual({ ok: true, config: { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" } });
  });

  it("names missing or blank variables without their values", () => {
    const r = readFirebaseConfig({ ...full, NEXT_PUBLIC_FIREBASE_API_KEY: " ", NEXT_PUBLIC_FIREBASE_APP_ID: undefined });
    expect(r).toEqual({ ok: false, missing: ["NEXT_PUBLIC_FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_APP_ID"] });
  });
});
