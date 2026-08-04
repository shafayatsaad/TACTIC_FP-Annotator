/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/videos/:path*',
        headers: [
          { key: 'Accept-Ranges', value: 'bytes' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
