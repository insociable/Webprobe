export function deriveSiteDisplayName(
  canonicalUrl: string,
  requestedName?: string | null,
): string {
  const custom = requestedName?.trim().replace(/\s+/g, " ");
  if (custom && custom.length >= 2) {
    return custom.slice(0, 160);
  }

  const hostname = new URL(canonicalUrl).hostname.toLowerCase();
  const withoutWww = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  return withoutWww.slice(0, 160);
}
