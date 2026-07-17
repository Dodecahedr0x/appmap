/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // /token (buying NEB) was folded into /rewards, alongside pool analytics
  // and reward claiming — redirect old links/bookmarks rather than 404.
  async redirects() {
    return [{ source: "/token", destination: "/rewards", permanent: true }];
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
