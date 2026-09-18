import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // @hg/ui-web ships TypeScript source, not a build. Next has to compile it.
  transpilePackages: ['@hg/ui-web'],
};

export default config;
