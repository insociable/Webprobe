import { createHash } from "node:crypto";
import { observeUrl } from "./url.js";

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
export type NetworkContentEncoding =
  | "br"
  | "deflate"
  | "gzip"
  | "identity"
  | "zstd"
  | "other";
export type NetworkIssueKind =
  | "http-4xx"
  | "http-5xx"
  | "request-failed"
  | "console-error"
  | "javascript-error";
export type NetworkFailureClass =
  | "aborted"
  | "blocked"
  | "connection"
  | "dns"
  | "timeout"
  | "other";
export type BrowserErrorClass =
  | "reference-error"
  | "type-error"
  | "syntax-error"
  | "range-error"
  | "uri-error"
  | "network-error"
  | "other";

export type NetworkResourceObservation = {
  pageUrl: string;
  resourceUrl: string;
  resourceKey: string;
  resourceType: NetworkResourceType;
  party: NetworkParty;
  statusCode: number;
  transferBytes: number | null;
  cacheControlled: boolean;
  contentEncoding: NetworkContentEncoding | null;
};

export type NetworkFailureObservation = {
  pageUrl: string;
  resourceUrl: string;
  resourceKey: string;
  resourceType: NetworkResourceType;
  party: NetworkParty;
  failureClass: NetworkFailureClass | null;
};

export type NetworkConsoleObservation = {
  pageUrl: string;
  errorClass: BrowserErrorClass;
};

export type NetworkIssueEvidence = {
  key: string;
  kind: NetworkIssueKind;
  party: NetworkParty;
  resourceType: NetworkResourceType | null;
  resourceUrl: string | null;
  resourceKey: string | null;
  statusCode: number | null;
  failureClass: NetworkFailureClass | null;
  errorClass: BrowserErrorClass | null;
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
  collection: {
    maxRetainedObservationCount: number;
    retainedObservationCount: number;
    droppedObservationCount: number;
    truncated: boolean;
  };
};

export type NetworkResponseInput = Omit<
  NetworkResourceObservation,
  | "resourceUrl"
  | "resourceKey"
  | "party"
  | "cacheControlled"
  | "contentEncoding"
> & {
  resourceUrl: string;
  cacheControl: string | null;
  contentEncoding: string | null;
};
export type NetworkFailureInput = Omit<
  NetworkFailureObservation,
  "resourceUrl" | "resourceKey" | "party" | "failureClass"
> & {
  resourceUrl: string;
  failureCode: string | null;
};

const defaultMaxRetainedNetworkObservations = 400;

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

function contentEncoding(value: string | null): NetworkContentEncoding | null {
  if (!value) {
    return null;
  }
  const normalized = value.slice(0, 64).trim().toLowerCase();
  switch (normalized) {
    case "br":
    case "deflate":
    case "gzip":
    case "identity":
    case "zstd":
      return normalized;
    default:
      return "other";
  }
}

function classifyFailure(value: string | null): NetworkFailureClass | null {
  if (!value) {
    return null;
  }
  const normalized = value.slice(0, 256).toLowerCase();
  if (normalized.includes("aborted")) {
    return "aborted";
  }
  if (normalized.includes("blocked")) {
    return "blocked";
  }
  if (normalized.includes("name_not_resolved") || normalized.includes("dns")) {
    return "dns";
  }
  if (normalized.includes("timed_out") || normalized.includes("timeout")) {
    return "timeout";
  }
  if (
    normalized.includes("connection") ||
    normalized.includes("connection_refused") ||
    normalized.includes("connection_reset")
  ) {
    return "connection";
  }
  return "other";
}

function classifyBrowserError(message: string): BrowserErrorClass {
  const normalized = message.slice(0, 256).trim().toLowerCase();
  if (normalized.startsWith("referenceerror")) {
    return "reference-error";
  }
  if (normalized.startsWith("typeerror")) {
    return "type-error";
  }
  if (normalized.startsWith("syntaxerror")) {
    return "syntax-error";
  }
  if (normalized.startsWith("rangeerror")) {
    return "range-error";
  }
  if (normalized.startsWith("urierror")) {
    return "uri-error";
  }
  if (normalized.includes("network")) {
    return "network-error";
  }
  return "other";
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
  private retainedObservationCount = 0;
  private droppedObservationCount = 0;

  constructor(
    firstPartyOrigin: string | null = null,
    private readonly maxRetainedObservationCount = defaultMaxRetainedNetworkObservations,
  ) {
    this.firstPartyOrigin = firstPartyOrigin;
  }

  setFirstPartyOrigin(origin: string): void {
    this.firstPartyOrigin = origin;
  }

  /**
   * Reserves a bounded slot before asynchronous response metadata collection.
   * This bounds both retained results and in-flight browser response promises.
   */
  reserveResponseCapture(): boolean {
    return this.reserveObservation();
  }

  recordResponse(input: NetworkResponseInput, reserved = false): void {
    if (!reserved && !this.reserveObservation()) {
      return;
    }
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
      cacheControlled: Boolean(input.cacheControl?.slice(0, 64).trim()),
      contentEncoding: contentEncoding(input.contentEncoding),
    });
  }

  recordFailure(input: NetworkFailureInput): void {
    if (!this.reserveObservation()) {
      return;
    }
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
      failureClass: classifyFailure(input.failureCode),
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
    if (!this.reserveObservation()) {
      return;
    }
    const page = observeUrl(pageUrl);
    if (!page) {
      return;
    }
    destination.push({
      pageUrl: page.displayUrl,
      errorClass: classifyBrowserError(message),
    });
  }

  private reserveObservation(): boolean {
    if (this.retainedObservationCount >= this.maxRetainedObservationCount) {
      this.droppedObservationCount += 1;
      return false;
    }
    this.retainedObservationCount += 1;
    return true;
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
        input.resourceKey ?? input.errorClass ?? "none",
        input.statusCode?.toString() ?? input.failureClass ?? "none",
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
        resourceKey: input.resourceKey,
        statusCode: input.statusCode,
        failureClass: input.failureClass,
        errorClass: input.errorClass,
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
          resourceKey: resource.resourceKey,
          statusCode: resource.statusCode,
          failureClass: null,
          errorClass: null,
          pageUrl: resource.pageUrl,
        });
      } else if (resource.statusCode >= 400) {
        addIssue({
          kind: "http-4xx",
          party: resource.party,
          resourceType: resource.resourceType,
          resourceUrl: resource.resourceUrl,
          resourceKey: resource.resourceKey,
          statusCode: resource.statusCode,
          failureClass: null,
          errorClass: null,
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
        resourceKey: failed.resourceKey,
        statusCode: null,
        failureClass: failed.failureClass,
        errorClass: null,
        pageUrl: failed.pageUrl,
      });
    }
    for (const consoleError of this.consoleErrors) {
      addIssue({
        kind: "console-error",
        party: "first-party",
        resourceType: null,
        resourceUrl: null,
        resourceKey: null,
        statusCode: null,
        failureClass: null,
        errorClass: consoleError.errorClass,
        pageUrl: consoleError.pageUrl,
      });
    }
    for (const javascriptError of this.javascriptErrors) {
      addIssue({
        kind: "javascript-error",
        party: "first-party",
        resourceType: null,
        resourceUrl: null,
        resourceKey: null,
        statusCode: null,
        failureClass: null,
        errorClass: javascriptError.errorClass,
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
      collection: {
        maxRetainedObservationCount: this.maxRetainedObservationCount,
        retainedObservationCount: this.retainedObservationCount,
        droppedObservationCount: this.droppedObservationCount,
        truncated: this.droppedObservationCount > 0,
      },
    };
  }
}
