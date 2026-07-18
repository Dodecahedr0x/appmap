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
          backgroundColor: "#10121a",
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(47, 61, 255, 0.35) 0%, rgba(16, 18, 26, 0) 60%)",
          padding: 80,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: -2,
            color: "#f2f6fa",
          }}
        >
          {SITE_NAME}
        </div>
        <div
          style={{
            display: "flex",
            textAlign: "center",
            fontSize: 32,
            color: "#9aa0ac",
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
