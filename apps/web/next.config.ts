import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@autonomo/shared"],
  poweredByHeader: false,
  // Fotos und Logos werden über Server-Aktionen hochgeladen
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default config;
