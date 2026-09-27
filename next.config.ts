import type { NextConfig } from "next";

/* Not a static export: the /api/bay proxy routes run on the server so the
 * backend key (BAY_API_KEY) stays out of the browser. Nothing here depends on
 * the deployment target; the backend location comes from BAY_API_URL. */
const nextConfig: NextConfig = {
  images: { unoptimized: true },
};

export default nextConfig;
