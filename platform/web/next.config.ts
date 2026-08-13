import type { NextConfig } from "next";
import path from "path";

const appRoot = path.join(__dirname);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A stray lockfile in C:\Users\siavash made Next treat the home folder as
  // the workspace root, so /_next/static chunks 404'd in the browser.
  outputFileTracingRoot: appRoot,
  turbopack: {
    root: appRoot
  }
};

export default nextConfig;
