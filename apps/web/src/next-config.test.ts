import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_EXPORT,
  PHASE_INFO,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
  PHASE_TEST,
} from "next/constants";
import { describe, expect, it } from "vitest";
import config, { BASE_PAGE_EXTENSIONS, nextConfig } from "../next.config";

const PHASES = [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER, PHASE_EXPORT, PHASE_TEST, PHASE_INFO];

describe("next.config phase (R20.3)", () => {
  it("adds dev.tsx only for the development server", () => {
    for (const phase of PHASES) {
      const ext = config(phase).pageExtensions ?? [];
      expect(ext.includes("dev.tsx"), phase).toBe(phase === PHASE_DEVELOPMENT_SERVER);
      for (const base of BASE_PAGE_EXTENSIONS) expect(ext, phase).toContain(base);
    }
    expect(BASE_PAGE_EXTENSIONS).toEqual(["tsx", "ts", "jsx", "js"]);
  });

  it("keeps every existing setting in every phase", () => {
    for (const phase of PHASES) {
      const c = config(phase);
      for (const [key, value] of Object.entries(nextConfig)) expect(c[key as keyof typeof c], `${phase} ${key}`).toEqual(value);
    }
    expect(nextConfig.transpilePackages).toEqual(["@franki/core", "@franki/server"]);
    expect(nextConfig.serverExternalPackages).toEqual(["firebase-admin"]);
  });
});
