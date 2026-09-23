"use client";

export function PrintReportButton() {
  return (
    <button
      type="button"
      className="am-button-secondary no-print"
      onClick={() => window.print()}
      aria-label="Imprimer ou enregistrer ce rapport au format PDF"
    >
      Imprimer / enregistrer en PDF
    </button>
  );
}
