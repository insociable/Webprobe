export type DisplayFindingLike = {
  code: string;
  pageUrl: string | null;
};

export type DisplayFindingGroup<T extends DisplayFindingLike> = {
  key: string;
  primary: T;
  findings: T[];
  pageUrls: string[];
};

export function groupFindingsForDisplay<T extends DisplayFindingLike>(
  findings: T[],
): DisplayFindingGroup<T>[] {
  const groups: DisplayFindingGroup<T>[] = [];
  const groupedNoindex = new Map<string, DisplayFindingGroup<T>>();

  for (const finding of findings) {
    if (finding.code !== "seo.noindex") {
      groups.push({
        key: `${finding.code}:${groups.length}`,
        primary: finding,
        findings: [finding],
        pageUrls: finding.pageUrl ? [finding.pageUrl] : [],
      });
      continue;
    }

    const key = "seo.noindex";
    const existing = groupedNoindex.get(key);
    if (existing) {
      existing.findings.push(finding);
      if (finding.pageUrl && !existing.pageUrls.includes(finding.pageUrl)) {
        existing.pageUrls.push(finding.pageUrl);
      }
      continue;
    }

    const group = {
      key,
      primary: finding,
      findings: [finding],
      pageUrls: finding.pageUrl ? [finding.pageUrl] : [],
    };
    groupedNoindex.set(key, group);
    groups.push(group);
  }

  return groups;
}
