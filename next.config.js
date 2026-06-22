/** @type {import('next').NextConfig} */
const nextConfig = {
  // Needed so ZXing WASM resolves correctly
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "application/javascript" },
      ],
    },
  ],
};

module.exports = nextConfig;
