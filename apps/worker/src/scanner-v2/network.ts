import { createHash } from "node:crypto";
import { observeUrl, safeDiagnosticPreview } from "./url.js";

export type NetworkResourceType =
  | "document"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "xhr"
  | "fetch"
  | "media"
  | "other";
export type NetworkParty = "first-party" | "third-party" | "unknown";
export type NetworkIssueKind =
  | "http-4xx"
  | "http-5xx"
  | "request-failed"
  | "console-error"
  | "javascript-error";

export type NetworkResourceObservation = {
  pageUrl: string;
  resourceUrl: string;
  resourceKey: string;
  resourceType: NetworkResourceType;
  party: NetworkParty;
  statusCode: number;
  transferBytes: number | null;
  cacheControl: string | null;
  contentEncoding: string | null;
};

export type NetworkFailureObservation = {
  pageUrl: string;
  resourceUrl: string;
  resourceKey: string;
  resourceType: NetworkResourceType;
  party: NetworkParty;
  failureCode: string | null;
};

export type NetworkConsoleObservation = {
  pageUrl: string;
  messageKey: string;
  messagePreview: string;
};

export type NetworkIssueEvidence = {
  key: string;
  kind: NetworkIssueKind;
  party: NetworkParty;
  resourceType: NetworkResourceType | null;
  resourceUrl: string | null;
  statusCode: number | null;
  failureCode: string | null;
  messagePreview: string | null;
  affectedPageUrls: string[];
  occurrenceCount: number;
};

export type NetworkObservation = {
  resources: NetworkResourceObservation[];
  failedRequests: NetworkFailureObservation[];
  consoleErrors: NetworkConsoleObservation[];
  javascriptErrors: NetworkConsoleObservation[];
  issues: NetworkIssueEvidence[];
  suppressedThirdPartyIssueCount: number;
};

export type NetworkResponseInput = Omit<
  NetworkResourceObservation,
  "resourceUrl" | "resourceKey" | "party"
> & {
  resourceUrl: string;
};
export type NetworkFailureInput = Omit<
  NetworkFailureObservation,
  "resourceUrl" | "resourceKey" | "party"
> & {
  resourceUrl: string;
};

function partyFor(
  resourceUrl: string,
  firstPartyOrigin: string | null,
): NetworkParty {
  const observed = observeUrl(resourceUrl);
  if (!observed || !firstPartyOrigin) {
    return "unknown";
  }
  return observed.origin === firstPartyOrigin ? "first-party" : "third-party";
}

function boundedBytes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function issueKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
}

type MutableIssue = Omit<NetworkIssueEvidence, "affectedPageUrls"> & {
  affectedPageUrls: Set<string>;
};

export class NetworkObservationCollector {
  private firstPartyOrigin: string | null;
  private readonly resources: NetworkResourceObservation[] = [];
  private readonly failedRequests: NetworkFailureObservation[] = [];
  private readonly consoleErrors: NetworkConsoleObservation[] = [];
  private readonly javascriptErrors: NetworkConsoleObservation[] = [];

  constructor(firstPartyOrigin: string | null = null) {
    this.firstPartyOrigin = firstPartyOrigin;
  }

  setFirstPartyOrigin(origin: string): void {
    this.firstPartyOrigin = origin;
  }

  recordResponse(input: NetworkResponseInput): void {
    const resource = observeUrl(input.resourceUrl);
    const page = observeUrl(input.pageUrl);
    if (!resource || !page) {
      return;
    }
    this.resources.push({
      pageUrl: page.displayUrl,
      resourceUrl: resource.displayUrl,
      resourceKey: resource.urlKey,
      resourceType: input.resourceType,
      party: partyFor(input.resourceUrl, this.firstPartyOrigin),
      statusCode: input.statusCode,
      transferBytes: boundedBytes(input.transferBytes),
      cacheControl: input.cacheControl,
      contentEncoding: input.contentEncoding,
    });
  }

  recordFailure(input: NetworkFailureInput): void {
    const resource = observeUrl(input.resourceUrl);
    const page = observeUrl(input.pageUrl);
    if (!resource || !page) {
      return;
    }
    this.failedRequests.push({
      pageUrl: page.displayUrl,
      resourceUrl: resource.displayUrl,
      resourceKey: resource.urlKey,
      resourceType: input.resourceType,
      party: partyFor(input.resourceUrl, this.firstPartyOrigin),
      failureCode: input.failureCode
        ? safeDiagnosticPreview(input.failureCode, 120)
        : null,
    });
  }

  recordConsoleError(pageUrl: string, message: string): void {
    this.recordError(this.consoleErrors, pageUrl, message);
  }

  recordJavascriptError(pageUrl: string, message: string): void {
    this.recordError(this.javascriptErrors, pageUrl, message);
  }

  private recordError(
    destination: NetworkConsoleObservation[],
    pageUrl: string,
    message: string,
  ): void {
    const page = observeUrl(pageUrl);
    if (!page) {
      return;
    }
    const messagePreview = safeDiagnosticPreview(message, 180);
    destination.push({
      pageUrl: page.displayUrl,
      messageKey: createHash("sha256").update(messagePreview).digest("hex"),
      messagePreview,
    });
  }

  snapshot(): NetworkObservation {
    const issues = new Map<string, MutableIssue>();
    let suppressedThirdPartyIssueCount = 0;
    const addIssue = (
      input: Omit<
        NetworkIssueEvidence,
        "key" | "affectedPageUrls" | "occurrenceCount"
      > & {
        pageUrl: string;
      },
    ) => {
      if (input.party === "third-party") {
        suppressedThirdPartyIssueCount += 1;
        return;
      }
      const key = issueKey([
        input.kind,
        input.party,
        input.resourceType ?? "none",
        input.resourceUrl ?? input.messagePreview ?? "none",
        input.statusCode?.toString() ?? input.failureCode ?? "none",
      ]);
      const existing = issues.get(key);
      if (existing) {
        existing.occurrenceCount += 1;
        existing.affectedPageUrls.add(input.pageUrl);
        return;
      }
      issues.set(key, {
        key,
        kind: input.kind,
        party: input.party,
        resourceType: input.resourceType,
        resourceUrl: input.resourceUrl,
        statusCode: input.statusCode,
        failureCode: input.failureCode,
        messagePreview: input.messagePreview,
        affectedPageUrls: new Set([input.pageUrl]),
        occurrenceCount: 1,
      });
    };

    for (const resource of this.resources) {
      if (resource.statusCode >= 500) {
        addIssue({
          kind: "http-5xx",
          party: resource.party,
          resourceType: resource.resourceType,
          resourceUrl: resource.resourceUrl,
          statusCode: resource.statusCode,
          failureCode: null,
          messagePreview: null,
          pageUrl: resource.pageUrl,
        });
      } else if (resource.statusCode >= 400) {
        addIssue({
          kind: "http-4xx",
          party: resource.party,
          resourceType: resource.resourceType,
          resourceUrl: resource.resourceUrl,
          statusCode: resource.statusCode,
          failureCode: null,
          messagePreview: null,
          pageUrl: resource.pageUrl,
        });
      }
    }
    for (const failed of this.failedRequests) {
      addIssue({
        kind: "request-failed",
        party: failed.party,
        resourceType: failed.resourceType,
        resourceUrl: failed.resourceUrl,
        statusCode: null,
        failureCode: failed.failureCode,
        messagePreview: null,
        pageUrl: failed.pageUrl,
      });
    }
    for (const consoleError of this.consoleErrors) {
      addIssue({
        kind: "console-error",
        party: "first-party",
        resourceType: null,
        resourceUrl: null,
        statusCode: null,
        failureCode: null,
        messagePreview: consoleError.messagePreview,
        pageUrl: consoleError.pageUrl,
      });
    }
    for (const javascriptError of this.javascriptErrors) {
      addIssue({
        kind: "javascript-error",
        party: "first-party",
        resourceType: null,
        resourceUrl: null,
        statusCode: null,
        failureCode: null,
        messagePreview: javascriptError.messagePreview,
        pageUrl: javascriptError.pageUrl,
      });
    }

    return {
      resources: [...this.resources],
      failedRequests: [...this.failedRequests],
      consoleErrors: [...this.consoleErrors],
      javascriptErrors: [...this.javascriptErrors],
      issues: [...issues.values()]
        .map((issue) => ({
          ...issue,
          affectedPageUrls: [...issue.affectedPageUrls].sort(),
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      suppressedThirdPartyIssueCount,
    };
  }
}
