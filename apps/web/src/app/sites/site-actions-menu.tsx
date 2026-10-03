"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  deleteSiteAction,
  type DeleteSiteActionState,
} from "./site-delete-actions";

const initialState: DeleteSiteActionState = { error: null };

type SiteActionsMenuProps = {
  organizationId: string;
  siteId: string;
  siteName: string;
};

export function SiteActionsMenu({
  organizationId,
  siteId,
  siteName,
}: SiteActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const action = deleteSiteAction.bind(null, organizationId, siteId, siteName);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions pour ${siteName}`}
        onClick={() => {
          setOpen((value) => !value);
          setConfirming(false);
        }}
        className="flex size-9 items-center justify-center rounded-md border border-transparent text-xl leading-none text-[#77839a] transition hover:border-[#303a50] hover:bg-[#111827] hover:text-[#e9edf6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8793ff]"
      >
        <span aria-hidden="true" className="-mt-2">
          ⋯
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={`Actions pour ${siteName}`}
          className="absolute right-0 top-11 z-20 w-72 rounded-lg border border-[#303a50] bg-[#0b1019] p-2 shadow-2xl"
        >
          {!confirming ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center rounded-md px-3 py-2.5 text-left text-sm text-red-200 transition hover:bg-red-300/[0.08] hover:text-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8793ff]"
            >
              Supprimer le site
            </button>
          ) : (
            <div
              role="dialog"
              aria-label={`Confirmer la suppression de ${siteName}`}
            >
              <p className="px-3 pt-2 text-sm font-semibold text-[#e9edf6]">
                Supprimer « {siteName} » ?
              </p>
              <p className="px-3 pt-2 text-xs leading-5 text-[#8793a8]">
                Cette action retire les scans, rapports, alertes et réglages du
                monitoring. Elle est irréversible.
              </p>
              <form action={formAction} className="mt-3 space-y-2 p-1">
                <label className="block text-xs text-[#aeb9cc]">
                  Tapez le nom du site pour confirmer
                  <input
                    autoFocus
                    required
                    name="confirmation"
                    autoComplete="off"
                    className="am-field mt-1 px-3 py-2 text-sm"
                    placeholder={siteName}
                  />
                </label>
                {state.error ? (
                  <p
                    aria-live="polite"
                    className="text-xs leading-5 text-amber-100"
                  >
                    {state.error}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                    }}
                    className="rounded-md px-3 py-2 text-xs font-semibold text-[#9aa6ba] transition hover:bg-[#151c2b] hover:text-[#e9edf6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8793ff]"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-md border border-red-300/30 bg-red-300/[0.08] px-3 py-2 text-xs font-semibold text-red-100 transition hover:bg-red-300/[0.14] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8793ff]"
                  >
                    {pending ? "Suppression…" : "Supprimer"}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
