import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@autonomo/shared"],
  poweredByHeader: false,
};

export default config;
