/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  pageExtensions: ["tsx", "ts", "jsx", "js"],
  transpilePackages: ["ol", "ol-ext", "resium", "cesium"],

  // Self-contained server bundle in .next/standalone/. Combined with
  // runtime-config injection (src/app/layout.tsx), this lets the same build
  // artifact be deployed to any environment.
  output: "standalone",
  // Flatten the standalone output to .next/standalone/server.js instead of
  // preserving the workspace path.
  outputFileTracingRoot: path.join(__dirname),

  reactStrictMode: true,

  // Files that need to opt out use a function-body "use no memo" directive.
  reactCompiler: true,

  compiler: {
    // Strip console.* from production bundles, except errors and warnings.
    removeConsole: { exclude: ["error", "warn"] }
  },

  experimental: {
    // Tree-shake barrel imports from these packages.
    optimizePackageImports: [
      "@heroui/accordion",
      "@heroui/alert",
      "@heroui/button",
      "@heroui/card",
      "@heroui/checkbox",
      "@heroui/chip",
      "@heroui/code",
      "@heroui/date-picker",
      "@heroui/divider",
      "@heroui/drawer",
      "@heroui/input",
      "@heroui/kbd",
      "@heroui/link",
      "@heroui/listbox",
      "@heroui/modal",
      "@heroui/navbar",
      "@heroui/pagination",
      "@heroui/popover",
      "@heroui/progress",
      "@heroui/radio",
      "@heroui/scroll-shadow",
      "@heroui/select",
      "@heroui/slider",
      "@heroui/snippet",
      "@heroui/spinner",
      "@heroui/switch",
      "@heroui/system",
      "@heroui/tabs",
      "@heroui/theme",
      "@heroui/tooltip",
      "@heroicons/react",
      "@react-aria/ssr",
      "@react-aria/visually-hidden",
      "@reduxjs/toolkit",
      "react-redux"
    ]
  },

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
