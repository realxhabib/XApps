import type { MetadataRoute } from "next";

/**
 * Lets people add XApps to their home screen. Opened from there it runs
 * without browser bars, the only true full screen an iPhone gives a web page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XApps",
    short_name: "XApps",
    description: "Mini games and meme duels against anyone on X.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#05060a",
    theme_color: "#05060a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
