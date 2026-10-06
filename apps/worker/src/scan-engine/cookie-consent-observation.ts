import { setTimeout as delay } from "node:timers/promises";
import type { BrowserContext } from "playwright";
import { abortable, throwIfAborted } from "./abort.js";

export type ObservedConsentCookie = {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
  firstObservedAfterLoadMs: number;
};

export type CookieConsentObservation = {
  method: "fresh-context-no-interaction";
  status: "observed" | "limited" | "unavailable";
  requestedWindowMs: number;
  observedWindowMs: number;
  sampleCount: number;
  reasons: Array<"time-budget" | "cookie-read-failed" | "cookie-limit">;
  cookies: ObservedConsentCookie[];
};

const observationWindowMs = 3_000;
const maxObservedCookies = 120;
const observationReserveMs = 2_000;

/** Only accepted browser cookies are evidence of storage, never raw Set-Cookie headers.
 * Snapshots retain an explicit metadata allowlist; cookie values never leave this module.
 */
export async function observeCookiesBeforeInteraction(input: {
  context: Pick<BrowserContext, "cookies">;
  remainingDurationMs: () => number;
  beforeObservation: () => Promise<void>;
  signal?: AbortSignal;
}): Promise<CookieConsentObservation> {
  const startedAt = Date.now();
  const allowedWindowMs = Math.max(
    0,
    Math.min(
      observationWindowMs,
      input.remainingDurationMs() - observationReserveMs,
    ),
  );
  const reasons = new Set<CookieConsentObservation["reasons"][number]>();
  if (allowedWindowMs < observationWindowMs) reasons.add("time-budget");
  const cookies = new Map<string, ObservedConsentCookie>();
  let sampleCount = 0;

  while (true) {
    throwIfAborted(input.signal);
    await input.beforeObservation();
    const readBudgetMs = Math.min(
      750,
      input.remainingDurationMs() - observationReserveMs,
    );
    if (readBudgetMs <= 0) {
      reasons.add("time-budget");
      break;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const snapshot = await abortable(
        Promise.race([
          input.context.cookies(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Cookie snapshot timed out")),
              readBudgetMs,
            );
          }),
        ]),
        input.signal,
      );
      sampleCount += 1;
      for (const cookie of snapshot) {
        const key = JSON.stringify([cookie.name, cookie.domain, cookie.path]);
        if (cookies.has(key)) continue;
        if (cookies.size >= maxObservedCookies) {
          reasons.add("cookie-limit");
          continue;
        }
        cookies.set(key, {
          name: cookie.name.slice(0, 128),
          domain: cookie.domain.slice(0, 253),
          path: cookie.path.split(/[?#]/, 1)[0]!.slice(0, 256),
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          firstObservedAfterLoadMs: Math.max(0, Date.now() - startedAt),
        });
      }
    } catch {
      throwIfAborted(input.signal);
      reasons.add("cookie-read-failed");
      break;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= allowedWindowMs) break;
    const waitMs = Math.min(
      500,
      allowedWindowMs - elapsedMs,
      input.remainingDurationMs() - observationReserveMs,
    );
    if (waitMs <= 0) {
      reasons.add("time-budget");
      break;
    }
    try {
      await delay(waitMs, undefined, { signal: input.signal });
    } catch {
      throwIfAborted(input.signal);
      throw new Error("Cookie observation interrupted");
    }
  }
  const observedWindowMs = Math.max(0, Date.now() - startedAt);
  if (observedWindowMs < observationWindowMs) reasons.add("time-budget");
  return {
    method: "fresh-context-no-interaction",
    status:
      sampleCount === 0
        ? "unavailable"
        : reasons.size > 0
          ? "limited"
          : "observed",
    requestedWindowMs: observationWindowMs,
    observedWindowMs,
    sampleCount,
    reasons: [...reasons],
    cookies: [...cookies.values()],
  };
}
