import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@control-room/shared-types'],
};

export default nextConfig;
