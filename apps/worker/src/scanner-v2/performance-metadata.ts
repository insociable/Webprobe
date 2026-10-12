export function performanceContentType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mime = value.slice(0, 256).split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(mime)
    ? mime
    : null;
}
export function performanceCacheControl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > 2048 || value.split(",").length > 20)
    return "policy-unrecognized";
  const result: string[] = [];
  for (const part of value.slice(0, 2048).split(",").slice(0, 20)) {
    const name = part.trim().split("=")[0]?.trim().toLowerCase() ?? "";
    if (
      [
        "private",
        "public",
        "no-store",
        "no-cache",
        "immutable",
        "must-revalidate",
        "proxy-revalidate",
      ].includes(name)
    )
      result.push(name);
    else if (
      [
        "max-age",
        "s-maxage",
        "stale-while-revalidate",
        "stale-if-error",
      ].includes(name)
    ) {
      const match = /^\s*[a-z-]+\s*=\s*"?([0-9]{1,12})"?\s*$/i.exec(part);
      if (match) result.push(name + "=" + match[1]);
    }
  }
  return result.length
    ? result.join(", ").slice(0, 256)
    : "policy-unrecognized";
}
export function performanceExpires(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toUTCString() : null;
}
export function compressionAccepted(value: unknown): boolean | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  return value
    .split(",")
    .slice(0, 20)
    .some((part) => {
      const coding =
        /^\s*(br|gzip|deflate|zstd|\*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/i.exec(
          part,
        );
      return coding !== null && Number(coding[2] ?? 1) > 0;
    });
}

export function performanceContentEncoding(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const coding = value.slice(0, 32).trim().toLowerCase();
  return ["br", "gzip", "deflate", "zstd", "identity"].includes(coding)
    ? coding
    : "other";
}
