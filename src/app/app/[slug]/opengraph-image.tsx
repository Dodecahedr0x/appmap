import { ImageResponse } from "next/og";
import { getAppDetail } from "@/lib/queries";
import { formatToken, formatNumber } from "@/lib/utils";
import { SITE_NAME } from "@/lib/constants";

export const alt = "App preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const bg = "#0b0f1a";
const border = "#232b3d";
const overlay = "#1a2234";
const green = "#14F195";
const purple = "#9945FF";
const slate = "#94a3b8";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getAppDetail(slug);

  if (!detail) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: bg,
            color: "white",
            fontSize: 56,
            fontWeight: 700,
          }}
        >
          {SITE_NAME}
        </div>
      ),
      { ...size }
    );
  }

  const { app } = detail;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: bg,
          backgroundImage:
            "radial-gradient(circle at 15% 0%, rgba(153,69,255,0.3), transparent 50%), radial-gradient(circle at 100% 100%, rgba(20,241,149,0.2), transparent 50%)",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={app.iconUrl}
              alt=""
              width={144}
              height={144}
              style={{ borderRadius: 32, objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 144,
                height: 144,
                borderRadius: 32,
                background: overlay,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 64,
                fontWeight: 800,
                color: green,
              }}
            >
              {app.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", fontSize: 60, fontWeight: 800, color: "white" }}>
              {app.name}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: overlay,
                  fontSize: 24,
                  color: slate,
                  textTransform: "capitalize",
                }}
              >
                {app.category}
              </div>
              <div
                style={{
                  display: "flex",
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: overlay,
                  fontSize: 24,
                  color: slate,
                  textTransform: "capitalize",
                }}
              >
                {app.chain}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 32,
            color: slate,
            maxWidth: 1000,
          }}
        >
          {app.tagline || app.description}
        </div>

        <div style={{ display: "flex", gap: 48, borderTop: `1px solid ${border}`, paddingTop: 32 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Rank score</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: green }}>
              {app.rankScore.toFixed(2)}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Votes</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: "white" }}>
              {formatToken(app.voteWeight, "")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Staked</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: "white" }}>
              {formatToken(app.stakeTotal, "")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 22, color: slate }}>Views</div>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: "white" }}>
              {formatNumber(app.viewCount)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              alignItems: "center",
              fontSize: 28,
              fontWeight: 700,
              backgroundImage: `linear-gradient(135deg, ${purple} 0%, ${green} 100%)`,
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {SITE_NAME}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
