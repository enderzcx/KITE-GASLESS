import type { NextConfig } from "next";

const envBasePath = String(process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const basePath =
  envBasePath.length > 0
    ? envBasePath.startsWith("/")
      ? envBasePath
      : `/${envBasePath}`
    : "";

const nextConfig: NextConfig = {
  basePath,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
