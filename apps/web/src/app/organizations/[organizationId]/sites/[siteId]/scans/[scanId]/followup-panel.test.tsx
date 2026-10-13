// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("./followup-actions", () => ({
  updateFindingFollowupAction: vi.fn(),
}));

import { updateFindingFollowupAction } from "./followup-actions";
import { FollowupPanel } from "./followup-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Result = { error: string | null; saved: boolean };
const actionMock = vi.mocked(updateFindingFollowupAction);
let host: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function field<
  T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
>(name: string): T {
  const element = host.querySelector<T>(`[name="${name}"]`);
  if (!element) throw new Error(`Missing field ${name}`);
  return element;
}

function change(
  name: string,
  value: string,
  prototype:
    | typeof HTMLInputElement
    | typeof HTMLSelectElement
    | typeof HTMLTextAreaElement,
) {
  const element = field(name);
  Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set?.call(
    element,
    value,
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit() {
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  actionMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <FollowupPanel
        organizationId="org-test"
        siteId="site-test"
        scanId="scan-test"
        fingerprint="finding-test"
        followup={null}
        members={[{ id: "member-test", name: "Membre Test" }]}
        events={[]}
        canManage
      />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("follow-up form", () => {
  it("retains every draft field after a server refusal", async () => {
    actionMock.mockResolvedValue({
      error: "Responsable hors de l’organisation.",
      saved: false,
    });
    act(() => {
      change("status", "in_progress", HTMLSelectElement);
      change("assignee", "member-test", HTMLSelectElement);
      change("due", "2026-10-20", HTMLInputElement);
      change("note", "Note conservée", HTMLTextAreaElement);
      submit();
    });
    await act(async () => {});
    expect(field<HTMLSelectElement>("status").value).toBe("in_progress");
    expect(field<HTMLSelectElement>("assignee").value).toBe("member-test");
    expect(field<HTMLInputElement>("due").value).toBe("2026-10-20");
    expect(field<HTMLTextAreaElement>("note").value).toBe("Note conservée");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Responsable hors",
    );
  });

  it("keeps a retyped note during a successful request and sends one request", async () => {
    const response = deferred<Result>();
    actionMock.mockReturnValue(response.promise);
    act(() => {
      change("note", "Même texte", HTMLTextAreaElement);
      submit();
      submit();
    });
    expect(actionMock).toHaveBeenCalledTimes(1);
    act(() => {
      change("note", "", HTMLTextAreaElement);
      change("note", "Même texte", HTMLTextAreaElement);
    });
    await act(async () => response.resolve({ error: null, saved: true }));
    expect(field<HTMLTextAreaElement>("note").value).toBe("Même texte");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Suivi enregistré",
    );
  });

  it("clears only the submitted note and does not resend it", async () => {
    actionMock.mockResolvedValue({ error: null, saved: true });
    act(() => {
      change("note", "Note envoyée", HTMLTextAreaElement);
      submit();
    });
    await act(async () => {});
    expect(field<HTMLTextAreaElement>("note").value).toBe("");
    act(() => {
      change("status", "in_progress", HTMLSelectElement);
      submit();
    });
    await act(async () => {});
    expect(actionMock).toHaveBeenCalledTimes(2);
    const secondSubmission = actionMock.mock.calls[1][5];
    expect(secondSubmission.get("note")).toBe("");
  });

  it("announces a network error and preserves the draft", async () => {
    actionMock.mockRejectedValue(new Error("network unavailable"));
    act(() => {
      change("note", "Brouillon réseau", HTMLTextAreaElement);
      submit();
    });
    await act(async () => {});
    expect(field<HTMLTextAreaElement>("note").value).toBe("Brouillon réseau");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "réessayez",
    );
  });
});
