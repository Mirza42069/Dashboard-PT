import "@DashboardV2/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  images: {
    remotePatterns: [
      // Vercel Blob public URLs: <storeId>.public.blob.vercel-storage.com.
      // The store id is unknown until the store exists, so match the suffix.
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default nextConfig;
