import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // pin the workspace root — a stray package-lock.json in a parent folder
  // otherwise confuses Turbopack's root inference
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
