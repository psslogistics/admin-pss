import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production") {
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_PSS_API_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  const placeholder = required.filter((name) => /placeholder|example\.invalid|your[-_]/i.test(process.env[name] ?? ""));
  if (missing.length || placeholder.length) throw new Error(`Invalid production configuration: ${[...missing, ...placeholder].join(", ")}`);
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://qyelfkmafzspctqkrwxf.supabase.co https://pss-api.psslogisticsadmin.workers.dev https://*.psslogistics.in https://*.vercel.app" },
    ] }];
  },
};

export default nextConfig;
