import { ImageResponse } from "next/og";

export const socialCardSize = { width: 1200, height: 630 } as const;

export function createSocialCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "62px 72px 46px",
          color: "#f3f6ff",
          background:
            "linear-gradient(125deg, #080a10 0%, #10162a 58%, #0b2430 100%)",
          fontFamily: "Arial, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 7,
            background: "linear-gradient(90deg, #6d7cff 0%, #39c7ff 100%)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 25 }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              width: 112,
              height: 112,
              border: "2px solid #46557a",
              borderRadius: 18,
              background: "#0f1522",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {[-18, 0, 18].map((offset) => (
              <div
                key={offset}
                style={{
                  position: "absolute",
                  left: 23,
                  top: 54 + offset,
                  width: 66,
                  height: 2,
                  background: offset === 0 ? "#8d98ff" : "#39c7ff",
                  opacity: offset === 0 ? 1 : 0.65,
                }}
              />
            ))}
            {[-18, 0, 18].map((offset) => (
              <div
                key={offset}
                style={{
                  position: "absolute",
                  top: 23,
                  left: 54 + offset,
                  height: 66,
                  width: 2,
                  background: offset === 0 ? "#8d98ff" : "#39c7ff",
                  opacity: offset === 0 ? 1 : 0.65,
                }}
              />
            ))}
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: "#ffffff",
                boxShadow: "0 0 17px #39c7ff",
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 78, fontWeight: 800, letterSpacing: -3 }}>
              WebProbe
            </div>
            <div
              style={{
                color: "#39c7ff",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 4,
              }}
            >
              AUDIT &amp; MONITORING
            </div>
          </div>
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", marginTop: 62 }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 54,
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            Voyez ce qui change.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 6,
              color: "#99a3ff",
              fontSize: 54,
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            Corrigez ce qui compte.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 28,
              color: "#b6c0d2",
              fontSize: 23,
            }}
          >
            Sécurité · Performance · SEO · CVE
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "auto",
            paddingTop: 19,
            borderTop: "1px solid #33405a",
            justifyContent: "space-between",
            color: "#aeb9cc",
            fontSize: 19,
          }}
        >
          <span>webprobe.fr</span>
          <span>Open source</span>
        </div>
      </div>
    ),
    {
      ...socialCardSize,
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" },
    },
  );
}
