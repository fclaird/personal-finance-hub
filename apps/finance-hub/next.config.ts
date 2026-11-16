import type { NextConfig } from "next";

/** When Electron runs `next dev`, use a separate output dir so a browser `next dev` can run in parallel (Next 16 lockDistDir). */
const isElectronDev = process.env.FINANCE_HUB_ELECTRON_DEV === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  // Dev responses were gzipped on the threadpool, and the completion microtask
  // then committed SQLite. Those two frames dominated the hung-process samples.
  // Keep gzip for `next start` (VPN / phone). Development serves plain JSON.
  compress: process.env.NODE_ENV === "production",
  serverExternalPackages: ["better-sqlite3"],
  ...(isElectronDev ? { distDir: ".next-desktop" } : {}),
  turbopack: {
    // Prevent Turbopack from walking up to ~ and selecting the wrong lockfile.
    root: __dirname,
  },
  experimental: {
    // Next 16 turns this on by default. The dev server then rewrites a persistent
    // Turbopack cache under .next for the life of the process. The 24h soak still
    // dirtied 156–267 KB/s of file-backed memory with the WAL file size flat.
    turbopackFileSystemCacheForDev: false,
    // Dev keeps every server-component payload for HMR. A day of polling retains it.
    serverComponentsHmrCache: false,
  },
};

export default nextConfig;
