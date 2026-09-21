import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class UnsafeTargetError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

export type DnsAnswer = {
  address: string;
  family: 4 | 6;
};

export type DnsResolver = (hostname: string) => Promise<readonly DnsAnswer[]>;

export const defaultDnsResolver: DnsResolver = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));
};

const blockedHostSuffixes = [".localhost", ".local", ".internal", ".lan"];

export function isPublicIp(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if ("isIPv4MappedAddress" in parsed && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function validateUrlShape(url: URL, hostname: string): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeTargetError(
      "scheme",
      "Only HTTP and HTTPS targets are allowed",
    );
  }
  if (url.username || url.password) {
    throw new UnsafeTargetError(
      "credentials",
      "Credentials in target URLs are forbidden",
    );
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw new UnsafeTargetError(
      "port",
      "Only standard HTTP(S) ports are allowed",
    );
  }
  if (
    hostname === "localhost" ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UnsafeTargetError("hostname", "Local hostnames are forbidden");
  }
}

export async function assertPublicHttpUrl(
  rawUrl: string,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<{ url: URL; hostname: string; addresses: readonly string[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTargetError("url", "Target is not a valid absolute URL");
  }

  const hostname = normalizedHostname(url);
  validateUrlShape(url, hostname);

  const literalFamily = ipaddr.isValid(hostname);
  const answers = literalFamily
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6,
        } as DnsAnswer,
      ]
    : await resolver(hostname).catch(() => {
        throw new UnsafeTargetError(
          "dns",
          "Target hostname could not be resolved",
        );
      });

  if (answers.length === 0) {
    throw new UnsafeTargetError(
      "dns-empty",
      "Target hostname has no IP address",
    );
  }

  const addresses = [...new Set(answers.map(({ address }) => address))];
  if (addresses.some((address) => !isPublicIp(address))) {
    throw new UnsafeTargetError(
      "non-public-ip",
      "Target resolves to a non-public IP address",
    );
  }

  return { url, hostname, addresses };
}
