import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // TypeScript 5.x for Next; monorepo root may use newer TS for ops packages.
  typescript: { ignoreBuildErrors: false },
};

export default config;
