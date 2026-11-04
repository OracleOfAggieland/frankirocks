import path from "node:path";
import type { NextConfig } from "next";

// The repo is a monorepo, so tracing and Turbopack must see packages/* and the root node_modules.
const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
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

export default nextConfig;
