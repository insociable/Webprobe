import http from "node:http";
import { config } from "dotenv";
import {
  createIsolatedBrowserSession,
  type IsolatedBrowserSession,
} from "../src/browser-runtime.js";

config({ path: new URL("../../../.env", import.meta.url) });

let sentinelHits = 0;
const sentinel = http.createServer((_request, response) => {
  sentinelHits += 1;
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("private sentinel");
});

await new Promise<void>((resolve, reject) => {
  sentinel.once("error", reject);
  sentinel.listen(0, "127.0.0.1", () => {
    sentinel.off("error", reject);
    resolve();
  });
});

const address = sentinel.address();
if (!address || typeof address === "string") {
  throw new Error("Sentinel did not bind to TCP");
}

let session: IsolatedBrowserSession | undefined;
try {
  session = await createIsolatedBrowserSession({
    navigationTimeoutMs: 15_000,
    maxPages: 1,
  });

  const page = await session.context.newPage();
  const publicResponse = await page.goto("https://example.com/", {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });

  if (!publicResponse || publicResponse.status() >= 400) {
    throw new Error("Public browser smoke target did not load");
  }

  let loopbackBlocked = false;
  try {
    const response = await page.goto(
      `http://127.0.0.1:${address.port}/sentinel`,
      {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      },
    );
    loopbackBlocked = (response?.status() ?? 0) >= 400;
  } catch {
    loopbackBlocked = true;
  }

  let metadataBlocked = false;
  try {
    const response = await page.goto(
      "http://169.254.169.254/latest/meta-data/",
      {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      },
    );
    metadataBlocked = (response?.status() ?? 0) >= 400;
  } catch {
    metadataBlocked = true;
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  if (!loopbackBlocked || sentinelHits !== 0) {
    throw new Error(
      `Browser bypassed the safe proxy for loopback traffic (blocked=${loopbackBlocked}, hits=${sentinelHits})`,
    );
  }
  if (!metadataBlocked) {
    throw new Error("Cloud metadata target was unexpectedly reachable");
  }

  console.log(
    JSON.stringify({
      ok: true,
      publicStatus: publicResponse.status(),
      loopbackBlocked,
      metadataBlocked,
      sentinelHits,
      pageCount: session.pageCount(),
    }),
  );
} finally {
  await session?.close().catch(() => undefined);
  await new Promise<void>((resolve) => sentinel.close(() => resolve()));
}
