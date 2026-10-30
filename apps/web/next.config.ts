import path from "node:path";
import type { NextConfig } from "next";

// The repo is a monorepo, so tracing and Turbopack must see packages/* and the root node_modules.
const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
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
