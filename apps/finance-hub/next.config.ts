import type { NextConfig } from "next";

/** When Electron runs `next dev`, use a separate output dir so a browser `next dev` can run in parallel (Next 16 lockDistDir). */
const isElectronDev = process.env.FINANCE_HUB_ELECTRON_DEV === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // nft does not follow bindings' runtime lookup of better_sqlite3.node.
  // prepareStandalone also copies the addon; this include keeps the trace honest.
  outputFileTracingIncludes: {
    "/**/*": [
      "./node_modules/better-sqlite3/build/**/*",
      "./node_modules/better-sqlite3/**/*.node",
      "./src/db/**/*.sql",
    ],
  },
  ...(isElectronDev ? { distDir: ".next-desktop" } : {}),
  turbopack: {
    // Prevent Turbopack from walking up to ~ and selecting the wrong lockfile.
    root: __dirname,
  },
};

export default nextConfig;
