import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme";

// "Add to Home Screen" name, icons and colours.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DeepARAM",
    short_name: "DeepARAM",
    description: "ARAM Mayhem tier list, augment rankings and a teamfight simulator.",
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    icons: [
      { src: "/icons/app/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/app/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
