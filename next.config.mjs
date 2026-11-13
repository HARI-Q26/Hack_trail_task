/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', 'pdf-parse'],
};

export default nextConfig;
