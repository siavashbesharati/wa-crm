import type { NextConfig } from "next";
import path from "path";

const appRoot = path.join(__dirname);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Local dev: browser uses /api (see lib/api.ts); Next proxies to the API container.
  async rewrites() {
    const apiOrigin = (process.env.INTERNAL_API_URL || "http://127.0.0.1:8000").replace(
      /\/api\/?$/,
      ""
    );
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  // A stray lockfile in C:\Users\siavash made Next treat the home folder as
  // the workspace root, so /_next/static chunks 404'd in the browser.
  outputFileTracingRoot: appRoot,
  // `standalone` makes `next build` emit a minimal .next/standalone folder
  // with only the files needed at runtime, ready to copy into a small
  // Docker image. Set to false in CI/dev to keep the dev server fast.
  // (Toggle via NEXT_OUTPUT_STANDALONE=1 in the build environment.)
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  turbopack: {
    root: appRoot
  }
};

export default nextConfig;
