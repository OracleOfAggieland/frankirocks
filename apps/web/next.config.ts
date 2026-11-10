import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// The repo is a monorepo, so tracing and Turbopack must see packages/* and the root node_modules.
const monorepoRoot = path.join(__dirname, "../..");

export const nextConfig: NextConfig = {
  // The browser's session.update names the transcription model (R13.1). The value comes only from
  // FRANKI_TRANSCRIBE_MODEL in apphosting.yaml (synced to .env.development.local for `next dev`).
  env: { NEXT_PUBLIC_FRANKI_TRANSCRIBE_MODEL: process.env.FRANKI_TRANSCRIBE_MODEL ?? "" },
  transpilePackages: ["@franki/core", "@franki/server"],
  serverExternalPackages: ["firebase-admin"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export const BASE_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
/** Development-only route files: `page.dev.tsx` pages and `route.dev.ts` handlers. */
export const DEV_PAGE_EXTENSIONS = ["dev.tsx", "dev.ts"];

/**
 * The config is a function of the phase (lab-ui-foundation R20.3). Only the development server adds the
 * `dev.tsx` and `dev.ts` page extensions, so `app/specimens/page.dev.tsx`, `app/recorder/page.dev.tsx` and
 * `app/api/dev/takes/route.dev.ts` are routes under `next dev` and no route at all in `next build` and
 * `next start`, whatever the shell's NODE_ENV.
 */
export default function config(phase: string): NextConfig {
  return {
    ...nextConfig,
    pageExtensions: phase === PHASE_DEVELOPMENT_SERVER ? [...BASE_PAGE_EXTENSIONS, ...DEV_PAGE_EXTENSIONS] : BASE_PAGE_EXTENSIONS,
  };
}
