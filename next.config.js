/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Configure webpack to handle mapbox-gl properly
  webpack: (config) => {
    // Required for mapbox-gl to work in production mode
    config.resolve.fallback = { 
      ...config.resolve.fallback,
      fs: false,
      path: false 
    };
    
    return config;
  },
}

module.exports = nextConfig