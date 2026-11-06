/** @type {import('next').NextConfig} */
const nextConfig = {
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
