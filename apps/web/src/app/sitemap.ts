import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Login is a duplicate of the landing page; project and account routes are private.
  return [{ url: `${SITE_URL}/` }];
}
