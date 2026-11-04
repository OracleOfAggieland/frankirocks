import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConfigError, firebaseProjectId, idHmacKey, openaiApiKey, requireEnv } from "./env";
import { MODEL_VARS, type ModelUse, configuredModels, healthModels, requireModel } from "./models";

const uses = Object.keys(MODEL_VARS) as ModelUse[];
// The "v-" prefix keeps generated values from being substrings of the error text by chance.
const secretish = fc.stringMatching(/^v-[A-Za-z0-9_-]{8,40}$/);

function catchConfig(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected ConfigError");
}

describe("config/models", () => {
  it("CONFIG names the missing variable without its value", () => {
    for (const use of uses) {
      for (const missing of [undefined, "", "   ", "\t\n"]) {
        const env = { ...Object.fromEntries(uses.map((u) => [MODEL_VARS[u], "other-value-xyz"])), [MODEL_VARS[use]]: missing };
        const error = catchConfig(() => requireModel(use, env));
        expect(error.code).toBe("CONFIG");
        expect(error.variable).toBe(MODEL_VARS[use]);
        expect(error.message).toContain(MODEL_VARS[use]);
        expect(error.message).not.toContain("other-value-xyz");
      }
    }
  });

  it("returns exactly the configured value", () => {
    fc.assert(
      fc.property(fc.constantFrom(...uses), secretish, (use, value) => {
        expect(requireModel(use, { [MODEL_VARS[use]]: value })).toBe(value);
      }),
    );
  });

  it("names the transcription variable", () => {
    expect(MODEL_VARS.transcribe).toBe("FRANKI_TRANSCRIBE_MODEL");
  });

  it("keeps the /api/health fallbacks and raw values", () => {
    expect(healthModels({})).toEqual({ brainModel: "gpt-6.1-terra", voiceModel: "gpt-realtime-2.1" });
    expect(healthModels({ FRANKI_BRAIN_MODEL: "b", FRANKI_VOICE_MODEL: "v" })).toEqual({ brainModel: "b", voiceModel: "v" });
    expect(configuredModels({})).toEqual({ brainModel: null, voiceModel: null });
    expect(configuredModels({ FRANKI_BRAIN_MODEL: "b", FRANKI_VOICE_MODEL: "" })).toEqual({ brainModel: "b", voiceModel: "" });
  });
});

describe("config/env", () => {
  it("names secrets and the project ID without values", () => {
    fc.assert(
      fc.property(secretish, (value) => {
        for (const [read, name] of [
          [openaiApiKey, "OPENAI_API_KEY"],
          [idHmacKey, "FRANKI_ID_HMAC_KEY"],
          [firebaseProjectId, "FRANKI_FIREBASE_PROJECT_ID"],
        ] as const) {
          expect(read({ [name]: value })).toBe(value);
          const error = catchConfig(() => read({ [name]: " ", OTHER: value }));
          expect(error.variable).toBe(name);
          expect(`${error.message} ${error.detail}`).not.toContain(value);
        }
      }),
    );
  });

  it("treats whitespace-only as missing", () => {
    expect(() => requireEnv("X", { X: "  " })).toThrow(ConfigError);
  });
});
