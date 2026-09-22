import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
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

const reportShareTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function reportTokenKey(secret: string): Buffer {
  if (secret.length < 32) {
    throw new Error("Report token secret must contain at least 32 characters");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function generateReportShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isReportShareToken(value: string): boolean {
  return reportShareTokenPattern.test(value);
}

export function hashReportShareToken(token: string): string {
  if (!isReportShareToken(token)) {
    throw new Error("Invalid report share token");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function encryptReportShareToken(token: string, secret: string): string {
  if (!isReportShareToken(token)) {
    throw new Error("Invalid report share token");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", reportTokenKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptReportShareToken(
  encrypted: string,
  secret: string,
): string {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid encrypted report token");
  }

  const [, ivValue, ciphertextValue, tagValue] = parts;
  if (!ivValue || !ciphertextValue || !tagValue) {
    throw new Error("Invalid encrypted report token");
  }

  try {
    const iv = Buffer.from(ivValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("Invalid encrypted report token");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      reportTokenKey(secret),
      iv,
    );
    decipher.setAuthTag(tag);
    const token = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    if (!isReportShareToken(token)) {
      throw new Error("Invalid decrypted report token");
    }
    return token;
  } catch {
    throw new Error("Invalid encrypted report token");
  }
}
