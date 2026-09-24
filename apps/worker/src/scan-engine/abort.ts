import { Resolver } from "node:dns/promises";
import type { DnsResolver } from "@agency-saas/security";

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Deep execution aborted");
}

export async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Deep execution aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/** Dedicated DNS resolver so cancelling one Deep operation stops its A/AAAA queries. */
export function cancellableDnsResolver(signal: AbortSignal): DnsResolver {
  return async (hostname) => {
    throwIfAborted(signal);
    const resolver = new Resolver();
    const onAbort = () => resolver.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const results = await abortable(
        Promise.allSettled([
          resolver.resolve4(hostname),
          resolver.resolve6(hostname),
        ]),
        signal,
      );
      throwIfAborted(signal);
      const addresses = results.flatMap((result, index) =>
        result.status === "fulfilled"
          ? result.value.map((address) => ({
              address,
              family: (index === 0 ? 4 : 6) as 4 | 6,
            }))
          : [],
      );
      if (addresses.length === 0) throw new Error("DNS resolution failed");
      return addresses;
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) resolver.cancel();
    }
  };
}
