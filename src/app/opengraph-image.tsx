import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_DESCRIPTION } from "@/lib/constants";

export const alt = SITE_NAME;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          background: "#0b0f1a",
          backgroundImage:
            "radial-gradient(circle at 25% 15%, rgba(153,69,255,0.35), transparent 55%), radial-gradient(circle at 80% 85%, rgba(20,241,149,0.25), transparent 55%)",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -2,
            backgroundImage: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {SITE_NAME}
        </div>
        <div
          style={{
            display: "flex",
            textAlign: "center",
            fontSize: 32,
            color: "#94a3b8",
            maxWidth: 900,
          }}
        >
          {SITE_DESCRIPTION}
        </div>
      </div>
    ),
    { ...size }
  );
}
