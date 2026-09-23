export type RobotsRule = {
  directive: "allow" | "disallow";
  pattern: string;
};

export type RobotsPolicy = {
  rules: RobotsRule[];
  sitemaps: string[];
};

type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

function normalizeAgent(value: string): string {
  return value.trim().toLowerCase().split("/")[0] ?? "";
}

function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^{}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + source + (anchored ? "$" : ""));
}

export function parseRobotsTxt(
  text: string,
  userAgent = "AgencyMonitor",
): RobotsPolicy {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let group: RobotsGroup | null = null;
  let seenDirective = false;

  for (const rawLine of text.slice(0, 65_536).split(/\r?\n/)) {
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
      group.rules.push({
        directive: key,
        pattern: value.slice(0, 2_048),
      });
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
  const target = url.pathname + url.search;
  let winner: RobotsRule | null = null;

  for (const rule of policy.rules) {
    if (!rule.pattern || !ruleRegex(rule.pattern).test(target)) continue;
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
