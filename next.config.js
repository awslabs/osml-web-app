/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["tsx", "ts", "jsx", "js"],
  transpilePackages: ["ol", "ol-ext", "resium", "cesium"],

  // Turbopack configuration (Next.js 16+ default bundler)
  // Note: CESIUM_BASE_URL is set in src/app/layout-client.tsx before Cesium imports
  turbopack: {
    resolveAlias: {
      // Disable Node.js polyfills for client-side code
      https: { browser: "" },
      zlib: { browser: "" },
      http: { browser: "" },
      url: { browser: "" }
    }
  },

  // Webpack configuration (used for production builds with --webpack flag)
  webpack: (config) => {
    // Disable Node.js polyfills for client-side code
    config.resolve.fallback = {
      ...config.resolve.fallback,
      https: false,
      zlib: false,
      http: false,
      url: false
    };

    return config;
  }
};

module.exports = nextConfig;
