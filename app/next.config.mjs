/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Old routes folded into other pages — redirect rather than 404.
  async redirects() {
    return [
      // Buying NEB moved into /rewards, alongside pool analytics and reward claiming.
      { source: "/token", destination: "/rewards", permanent: true },
      // App submission moved into a "Create app" modal on the Discover page.
      { source: "/submit", destination: "/", permanent: true },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
  webpack: (config) => {
    // Solana / wallet-adapter pull in optional native deps we don't need in the browser.
    config.externals = config.externals || [];
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
