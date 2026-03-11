import type { NextConfig } from "next";

const envAllowedOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Allow LAN/dev hostnames explicitly to avoid cross-origin warnings in Next dev mode.
  allowedDevOrigins: ["localhost", "127.0.0.1", ...envAllowedOrigins],
};

export default nextConfig;
