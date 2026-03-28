import type { NextConfig } from 'next';

/**
 * Next.js configuration for Universal Intent Bridge.
 *
 * Security headers are applied globally to all responses.
 * The API key is strictly server-side (never exposed to the browser via
 * `publicRuntimeConfig` or `NEXT_PUBLIC_*` env vars).
 */
const nextConfig: NextConfig = {
  /**
   * HTTP security headers applied to every route.
   *
   * - X-Content-Type-Options: prevents MIME-sniffing attacks.
   * - X-Frame-Options: prevents clickjacking.
   * - Referrer-Policy: limits referrer information leakage.
   * - Permissions-Policy: disables access to sensitive browser APIs.
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options',   value: 'nosniff' },
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
