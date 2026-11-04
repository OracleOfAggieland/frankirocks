import type { App } from "firebase-admin/app";
import { describe, expect, it } from "vitest";
import { type AdminSdk, adminApp } from "./admin";
import { ConfigError } from "./env";

function fakeSdk(): AdminSdk & { calls: { projectId: string }[] } {
  const apps: App[] = [];
  const calls: { projectId: string }[] = [];
  return {
    calls,
    getApps: () => apps,
    initializeApp: (options) => {
      calls.push(options);
      const app = { name: "[DEFAULT]", options } as unknown as App;
      apps.push(app);
      return app;
    },
  };
}

describe("config/admin", () => {
  it("CONFIG when FRANKI_FIREBASE_PROJECT_ID is missing", () => {
    for (const env of [{}, { FRANKI_FIREBASE_PROJECT_ID: "" }, { FRANKI_FIREBASE_PROJECT_ID: "   " }]) {
      const sdk = fakeSdk();
      let error: unknown = null;
      try {
        adminApp(env, sdk);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).variable).toBe("FRANKI_FIREBASE_PROJECT_ID");
      expect(sdk.calls).toEqual([]);
    }
  });

  it("initializes once with the explicit project ID", () => {
    const sdk = fakeSdk();
    const env = { FRANKI_FIREBASE_PROJECT_ID: "frankirocks" };
    const first = adminApp(env, sdk);
    const second = adminApp(env, sdk);
    expect(second).toBe(first);
    expect(sdk.calls).toEqual([{ projectId: "frankirocks" }]);
  });
});
