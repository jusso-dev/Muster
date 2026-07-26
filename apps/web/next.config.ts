import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/sharp/**/*",
      "node_modules/@img/sharp-*/**/*",
      "node_modules/@img/sharp-libvips-*/**/*",
      "../../node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/**/*",
      "../../node_modules/.pnpm/@img+sharp-libvips-*/node_modules/@img/sharp-libvips-*/**/*",
    ],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  transpilePackages: [
    "@muster/auth",
    "@muster/authz",
    "@muster/contracts",
    "@muster/database",
    "@muster/event-protocol",
    "@muster/investigations",
    "@muster/rooms",
  ],
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
    useTypeScriptCli: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; connect-src 'self'; worker-src 'self' blob:; object-src 'none'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
