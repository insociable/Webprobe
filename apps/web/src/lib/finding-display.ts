export type DisplayFindingLike = {
  code: string;
  pageUrl: string | null;
};

export type DisplayFindingGroup<T extends DisplayFindingLike> = {
  key: string;
  primary: T;
  findings: T[];
  pageUrls: string[];
  occurrenceCount: number;
};

export function groupFindingsForDisplay<T extends DisplayFindingLike>(
  findings: T[],
): DisplayFindingGroup<T>[] {
  const groups = new Map<string, DisplayFindingGroup<T>>();

  for (const finding of findings) {
    const key = finding.code;
    const existing = groups.get(key);

    if (existing) {
      existing.findings.push(finding);
      existing.occurrenceCount += 1;
      if (finding.pageUrl && !existing.pageUrls.includes(finding.pageUrl)) {
        existing.pageUrls.push(finding.pageUrl);
      }
      continue;
    }

    groups.set(key, {
      key,
      primary: finding,
      findings: [finding],
      pageUrls: finding.pageUrl ? [finding.pageUrl] : [],
      occurrenceCount: 1,
    });
  }

  return [...groups.values()];
}
