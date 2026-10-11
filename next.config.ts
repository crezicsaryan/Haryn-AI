import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tailwind v4 is wired in through the Turbopack CSS loader (see create-next-app).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
