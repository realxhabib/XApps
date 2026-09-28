import { ImageResponse } from "next/og";
import { OFFICIAL_APPS, getOfficialApp } from "@/platform/catalog";

export const alt = "An app on XApps";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return OFFICIAL_APPS.map((app) => ({ slug: app.slug }));
}

export default async function AppOpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = getOfficialApp(slug);
  const [from, to] = app?.accent ?? ["#5b74ff", "#a35cff"];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: `radial-gradient(circle at 85% 15%, ${from} 0%, transparent 45%), radial-gradient(circle at 100% 100%, ${to} 0%, transparent 45%), #05060a`,
          color: "#f6f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 700, color: "#b8bfcf", letterSpacing: 6 }}>XAPPS · CHALLENGE ANYONE ON X</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 36,
              background: `linear-gradient(135deg, ${from}, ${to})`,
              marginBottom: 36,
            }}
          />
          <div style={{ fontSize: 110, fontWeight: 900, letterSpacing: -4, lineHeight: 1 }}>{app?.name ?? "XApps"}</div>
          <div style={{ marginTop: 20, fontSize: 38, color: "#dfe3ec" }}>{app?.tagline ?? "Head-to-head apps on X."}</div>
        </div>
      </div>
    ),
    size,
  );
}
