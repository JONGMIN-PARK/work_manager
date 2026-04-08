/** @type {import('next').NextConfig} */
module.exports = {
  output: process.env.DOCKER_BUILD ? 'standalone' : undefined,
  async rewrites() {
    var apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    return [
      { source: '/api/:path*', destination: apiUrl + '/api/:path*' }
    ];
  }
};
