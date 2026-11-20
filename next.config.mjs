import { createHash, randomUUID } from 'node:crypto';

// Bind the worker and the account label to the artifact, not a request or a commit.
// Hash a public deployment identifier when available; standalone builds mint a nonce.
const buildLabel = createHash('sha256').update(process.env.VERCEL_DEPLOYMENT_ID || randomUUID()).digest('hex').slice(0, 32);
/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: () => buildLabel,
  env: { MAHA_WEB_BUILD_LABEL: buildLabel },
  reactStrictMode: true,
  // Config-level redirects run before rendering, so legacy requests receive
  // actual HTTP 308 responses rather than streamed HTML meta refreshes.
  async redirects() {
    return ['privacy', 'terms', 'shipping', 'returns'].map((page) => ({
      source: `/${page}`,
      destination: `/legal/${page}`,
      permanent: true,
    }));
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
