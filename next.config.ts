import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // ---------------------------------------------------------------------------
  // Security: hide server identity
  // ---------------------------------------------------------------------------
  poweredByHeader: false,
  productionBrowserSourceMaps: false,  // Don't expose source maps in production

  // ---------------------------------------------------------------------------
  // TypeScript: don't ignore errors in production
  // ---------------------------------------------------------------------------
  typescript: {
    ignoreBuildErrors: false,
  },

  // ---------------------------------------------------------------------------
  // Security: strict CSP, Trusted Types, compression
  // ---------------------------------------------------------------------------
  compress: true,  // Enable gzip compression

  // ---------------------------------------------------------------------------
  // Headers: security + caching
  // ---------------------------------------------------------------------------
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Security headers (also set in middleware, but double-locked here)
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "X-Download-Options", value: "noopen" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          // HSTS (only meaningful with HTTPS, but set anyway)
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // API routes: no caching (sensitive data)
        source: "/api/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // Static assets: long cache (immutable)
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Brand assets: medium cache
        source: "/brand/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800" },
        ],
      },
    ];
  },

  // ---------------------------------------------------------------------------
  // Redirects: API versioning (old paths → /v1/)
  // ---------------------------------------------------------------------------
  async redirects() {
    return [
      // Redirect unversioned API calls to v1 (with deprecation notice)
      // In production, this would return a Sunset header
    ];
  },

  // ---------------------------------------------------------------------------
  // Turbopack config (Next.js 16 default)
  // ---------------------------------------------------------------------------
  turbopack: {
    rules: {
      // Bundle analyzer can be added here when turbopack supports it
    },
  },

  // ---------------------------------------------------------------------------
  // External packages (for serverless deployment)
  // ---------------------------------------------------------------------------
  serverExternalPackages: ["@noble/curves", "@noble/hashes", "@noble/ciphers"],
};

export default nextConfig;
