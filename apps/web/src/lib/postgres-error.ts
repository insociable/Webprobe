export function hasPostgresErrorCode(
  error: unknown,
  expectedCode: string,
): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);

    if (
      "code" in current &&
      typeof current.code === "string" &&
      current.code === expectedCode
    ) {
      return true;
    }

    current = "cause" in current ? current.cause : null;
  }

  return false;
}
