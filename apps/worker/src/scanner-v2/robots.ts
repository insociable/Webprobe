export type RobotsRule = {
  directive: "allow" | "disallow";
  pattern: string;
};

export type RobotsPolicy = {
  rules: RobotsRule[];
  sitemaps: string[];
  /** An incomplete or excessive policy must never be interpreted as Allow. */
  unavailableReason?:
    | "document-too-large"
    | "document-size-unconfirmed"
    | "too-many-rules"
    | "rule-too-long"
    | "too-many-wildcards"
    | "invalid-rule";
};

type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

export const MAX_ROBOTS_BYTES = 65_536;
export const MAX_ROBOTS_RULES = 1_024;
export const MAX_ROBOTS_RULE_BYTES = 2_048;
export const MAX_ROBOTS_WILDCARDS = 32;
const MAX_ROBOTS_TARGET_BYTES = 8_192;
const MAX_ROBOTS_MATCH_STEPS = 100_000;

function normalizeAgent(value: string): string {
  return value.trim().toLowerCase().split("/")[0] ?? "";
}

function unavailablePolicy(
  reason: NonNullable<RobotsPolicy["unavailableReason"]>,
): RobotsPolicy {
  return { rules: [], sitemaps: [], unavailableReason: reason };
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function isUnreserved(byte: number): boolean {
  return (
    (byte >= 65 && byte <= 90) ||
    (byte >= 97 && byte <= 122) ||
    (byte >= 48 && byte <= 57) ||
    byte === 45 ||
    byte === 46 ||
    byte === 95 ||
    byte === 126
  );
}

function normalizePercentEscapes(
  value: string,
  rejectAmbiguousPathEscapes: boolean,
): string | null {
  let normalized = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "%") {
      const high = hexValue(value.charCodeAt(index + 1));
      const low = hexValue(value.charCodeAt(index + 2));
      if (high < 0 || low < 0) return null;

      const byte = (high << 4) | low;
      // An origin may decode these into delimiters or another escape pass.
      if (
        rejectAmbiguousPathEscapes &&
        (byte === 0x2f ||
          byte === 0x5c ||
          byte === 0x3f ||
          byte === 0x23 ||
          byte === 0x25)
      ) {
        return null;
      }

      normalized += isUnreserved(byte)
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      index += 2;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (
      codePoint === undefined ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return null;
    }
    if (codePoint > 0x7f) {
      const utf8 = Buffer.from(String.fromCodePoint(codePoint), "utf8");
      for (const byte of utf8) {
        normalized += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      index += codePoint > 0xffff ? 1 : 0;
    } else if (
      codePoint === 0x20 ||
      codePoint === 0x22 ||
      codePoint === 0x3c ||
      codePoint === 0x3e ||
      codePoint === 0x5e ||
      codePoint === 0x60 ||
      codePoint === 0x7b ||
      codePoint === 0x7d
    ) {
      normalized += `%${codePoint.toString(16).toUpperCase().padStart(2, "0")}`;
    } else if (codePoint < 0x20 || codePoint === 0x5c || codePoint === 0x7f) {
      return null;
    } else {
      normalized += character;
    }
  }

  return normalized;
}

function normalizedTarget(url: URL): string | null {
  const raw = url.pathname + url.search;
  if (Buffer.byteLength(raw, "utf8") > MAX_ROBOTS_TARGET_BYTES) return null;

  const path = normalizePercentEscapes(url.pathname, true);
  const query = normalizePercentEscapes(url.search, false);
  if (path === null || query === null) return null;

  const target = path + query;
  return Buffer.byteLength(target, "utf8") <= MAX_ROBOTS_TARGET_BYTES
    ? target
    : null;
}

/** Matches a prefix glob in bounded, non-backtracking time. */
function ruleMatches(
  patternWithAnchor: string,
  target: string,
  budget: { remaining: number },
): boolean | null {
  const anchored = patternWithAnchor.endsWith("$");
  const pattern = anchored ? patternWithAnchor.slice(0, -1) : patternWithAnchor;
  let patternIndex = 0;
  let targetIndex = 0;
  let lastStarIndex = -1;
  let lastStarTargetIndex = 0;

  while (true) {
    if (budget.remaining-- <= 0) return null;
    if (!anchored && patternIndex === pattern.length) return true;
    if (targetIndex === target.length) {
      while (pattern[patternIndex] === "*") {
        if (budget.remaining-- <= 0) return null;
        patternIndex += 1;
      }
      return patternIndex === pattern.length;
    }
    if (pattern[patternIndex] === "*") {
      lastStarIndex = patternIndex;
      lastStarTargetIndex = targetIndex;
      patternIndex += 1;
      continue;
    }
    if (pattern[patternIndex] === target[targetIndex]) {
      patternIndex += 1;
      targetIndex += 1;
      continue;
    }
    if (lastStarIndex < 0) return false;
    lastStarTargetIndex += 1;
    targetIndex = lastStarTargetIndex;
    patternIndex = lastStarIndex + 1;
  }
}

export function parseRobotsTxt(
  text: string,
  userAgent = "AgencyMonitor",
  options: { completeAtByteLimit?: boolean } = {},
): RobotsPolicy {
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > MAX_ROBOTS_BYTES) {
    return unavailablePolicy("document-too-large");
  }
  // The current browser loader may have sliced the response at this exact
  // boundary. Only a loader that saw EOF may certify an exact-size document.
  if (byteLength === MAX_ROBOTS_BYTES && !options.completeAtByteLimit) {
    return unavailablePolicy("document-size-unconfirmed");
  }

  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let group: RobotsGroup | null = null;
  let seenDirective = false;
  let ruleCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "sitemap") {
      if (value) sitemaps.push(value.slice(0, 2_048));
      continue;
    }

    if (key === "user-agent") {
      if (!group || seenDirective) {
        group = { agents: [], rules: [] };
        groups.push(group);
        seenDirective = false;
      }
      group.agents.push(normalizeAgent(value));
      continue;
    }

    if ((key === "allow" || key === "disallow") && group) {
      seenDirective = true;
      if (key === "disallow" && !value) continue;
      if (++ruleCount > MAX_ROBOTS_RULES) {
        return unavailablePolicy("too-many-rules");
      }
      if (Buffer.byteLength(value, "utf8") > MAX_ROBOTS_RULE_BYTES) {
        return unavailablePolicy("rule-too-long");
      }
      if (
        [...value].filter((character) => character === "*").length >
        MAX_ROBOTS_WILDCARDS
      ) {
        return unavailablePolicy("too-many-wildcards");
      }
      const pattern = normalizePercentEscapes(value, false);
      if (pattern === null) return unavailablePolicy("invalid-rule");
      if (Buffer.byteLength(pattern, "utf8") > MAX_ROBOTS_RULE_BYTES) {
        return unavailablePolicy("rule-too-long");
      }
      group.rules.push({ directive: key, pattern });
    }
  }

  const token = normalizeAgent(userAgent);
  const specific = groups.filter((item) => item.agents.includes(token));
  const selected =
    specific.length > 0
      ? specific
      : groups.filter((item) => item.agents.includes("*"));

  return {
    rules: selected.flatMap((item) => item.rules),
    sitemaps: [...new Set(sitemaps)].slice(0, 32),
  };
}

export function isRobotsPathAllowed(policy: RobotsPolicy, url: URL): boolean {
  if (policy.unavailableReason || policy.rules.length > MAX_ROBOTS_RULES) {
    return false;
  }
  const target = normalizedTarget(url);
  if (target === null) return false;

  let winner: RobotsRule | null = null;
  const budget = { remaining: MAX_ROBOTS_MATCH_STEPS };

  for (const rule of policy.rules) {
    if (
      Buffer.byteLength(rule.pattern, "utf8") > MAX_ROBOTS_RULE_BYTES ||
      [...rule.pattern].filter((character) => character === "*").length >
        MAX_ROBOTS_WILDCARDS
    ) {
      return false;
    }
    if (!rule.pattern) continue;
    const matches = ruleMatches(rule.pattern, target, budget);
    if (matches === null) return false;
    if (!matches) continue;
    if (
      !winner ||
      rule.pattern.length > winner.pattern.length ||
      (rule.pattern.length === winner.pattern.length &&
        rule.directive === "allow")
    ) {
      winner = rule;
    }
  }

  return winner?.directive !== "disallow";
}
