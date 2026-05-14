import type { NextConfig } from "next";

const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Baked at build: must match runtime VIEWER_WRITE_TOKEN on the server for header auth.
    NEXT_PUBLIC_VIEWER_WRITE_TOKEN: process.env.VIEWER_WRITE_TOKEN ?? "",
  },
};

export default nextConfig;
