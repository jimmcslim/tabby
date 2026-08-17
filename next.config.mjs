/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["bun:sqlite"],
  // The E2E harness boots a second dev server against a scratch database
  // (tests/server.ts). Two `next dev` processes sharing one `.next` corrupt
  // each other's build output, so the harness points this at `.next-test`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
}

export default nextConfig
