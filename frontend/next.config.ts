import type { NextConfig } from "next";
import path from "path";

export const output = "export";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
