import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Muster",
    short_name: "Muster",
    description:
      "The shared workspace for human and agent-driven security operations.",
    start_url: "/",
    display: "standalone",
    background_color: "#15191f",
    theme_color: "#15191f",
    icons: [
      { src: "/muster-logo.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
