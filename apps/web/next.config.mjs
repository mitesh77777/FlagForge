/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@flagforge/sdk', '@flagforge/evaluator'],
};

export default nextConfig;