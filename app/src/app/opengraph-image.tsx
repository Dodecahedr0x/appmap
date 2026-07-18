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
          backgroundColor: "#1f232e",
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(50, 69, 255, 0.35) 0%, rgba(31, 35, 46, 0) 60%)",
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
            color: "#858b98",
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
