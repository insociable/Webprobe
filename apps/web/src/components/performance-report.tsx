import { sanitizeReportUrl } from "../lib/report-technical-details";
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function list(v: unknown, cap: number) {
  return Array.isArray(v) ? v.slice(0, cap).map(record) : [];
}
function text(v: unknown, cap = 512) {
  return typeof v === "string" ? v.slice(0, cap) : "Non disponible";
}
function value(v: unknown, unit = "") {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12
    ? (Math.round(v * 1000) / 1000).toLocaleString("fr-FR") + unit
    : "Non mesuré";
}
function bytes(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e12
    ? (v / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) +
        " Ko connus"
    : "Poids inconnu";
}
const reasonLabels: Record<string, string> = {
  "resource-size-unavailable":
    "Certaines tailles ou réponses ne sont pas disponibles",
  "metric-unavailable": "Une mesure attendue est indisponible",
  "measurement-unavailable": "Instrumentation ou fenêtre indisponible",
  "page-hidden": "Page non visible pendant l’observation",
  "observer-entry-limit": "Plafond d’entrées atteint",
  "resource-collection-limit": "Collecte de ressources tronquée",
  "blocked-resources": "Des ressources ont été bloquées ou ont échoué",
  "unsupported-performance-api": "Certaines API ne sont pas supportées",
  "paint-not-observed": "Affichage ou candidat LCP non observé",
  "navigation-timing-unavailable": "Timing de navigation indisponible",
};
export function PerformanceReport({ observation }: { observation: unknown }) {
  const data = record(observation);
  if (data.metricVersion !== "2.0.0") return null;
  if (data.coverage === "unavailable" && !data.metrics)
    return (
      <p className="mt-4 text-sm text-amber-100">
        Les mesures de performance ne sont pas disponibles pour ce scan. Aucun
        résultat favorable n’est déduit de leur absence.
      </p>
    );
  const context = record(data.context),
    metrics = record(data.metrics),
    resources = record(data.resources);
  const viewport = record(context.viewport);
  const partial = data.coverage !== "observed";
  return (
    <div className="mt-4 min-w-0 space-y-4">
      <p className="text-sm text-white/60">
        Mesures de laboratoire dans l’environnement WebProbe · v2.0.0
      </p>
      <p className="break-all text-sm text-white/50">
        {sanitizeReportUrl(text(data.pageUrl))}
      </p>
      <p className="text-sm text-white/50">
        Fenêtre : navigation → {value(context.windowEndMs, " ms")}. Viewport :{" "}
        {value(viewport.width)} × {value(viewport.height)}. Cache :{" "}
        {context.cacheState === "cold"
          ? "contexte neuf, première navigation"
          : "état inconnu"}
        .
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["TTFB", "ttfbMs", " ms"],
          ["Premier contenu (FCP)", "fcpMs", " ms"],
          ["Candidat LCP", "lcpMs", " ms"],
          ["Stabilité (CLS)", "cls", ""],
          ["Blocage du thread observé", "observedThreadBlockingMs", " ms"],
        ].map(([label, key, unit]) => (
          <div
            key={key}
            className="min-w-0 rounded border border-[#303a50] p-3"
          >
            <p className="text-sm text-white/50">{label}</p>
            <p className="mt-1 text-base text-white/85">
              {value(record(metrics[key]).value, unit)}
            </p>
            {record(metrics[key]).value === null ? (
              <p className="mt-1 text-xs text-white/45">
                {reasonLabels[text(record(metrics[key]).reason)] ??
                  "API, fenêtre ou donnée indisponible"}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-sm text-white/60">
        INP : non mesuré — aucune interaction utilisateur.
      </p>
      <p className="text-sm leading-6 text-white/50">
        {text(context.ttfbDefinition)}. {text(context.clsDefinition)}{" "}
        {text(context.blockingDefinition)}
      </p>
      <p
        className={
          partial
            ? "text-sm leading-6 text-amber-100"
            : "text-sm leading-6 text-white/50"
        }
      >
        {text(context.network)}
      </p>
      {partial ? (
        <p className="text-sm text-amber-100">
          Couverture{" "}
          {data.coverage === "unavailable" ? "indisponible" : "partielle"} : ces
          mesures ne permettent pas de conclure que le chargement complet est
          rapide.
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/80">
        {(Array.isArray(data.reasons) ? data.reasons : [])
          .slice(0, 10)
          .map((reason, index) => (
            <li key={index}>
              {reasonLabels[text(reason)] ?? "Observation incomplète"}
            </li>
          ))}
      </ul>
      <p className="text-sm text-white/60">
        {value(resources.observedCount)} ressources observées ·{" "}
        {value(resources.blockedCount)} bloquées/échouées ·{" "}
        {value(data.excludedThirdPartyRequests)} requêtes tierces exclues.
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[
          ["Transfert (en-têtes inclus)", "transfer"],
          ["Corps encodés", "encodedBody"],
          ["Corps décodés", "decodedBody"],
          ["Content-Length déclaré", "declaredBody"],
        ].map(([label, key]) => {
          const t = record(resources[key]);
          return (
            <div key={key}>
              <dt className="text-white/50">{label}</dt>
              <dd className="mt-1 text-white/80">
                {bytes(t.knownBytes)} · {value(t.knownCount)}/
                {value(t.observedCount)} tailles connues
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-xs leading-5 text-white/45">
        Les tailles déclarées ne prouvent pas le poids reçu. Un zéro de Resource
        Timing peut masquer le cache ou une restriction d’accès ; il reste
        inconnu sans autre preuve.
      </p>
      <details className="rounded border border-[#303a50] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[#8793ff]">
          Ressources, cache, compression et images
        </summary>
        <p className="mt-3 text-sm text-white/60">
          Compression : {value(record(data.compression).evaluatedCount)}/
          {value(record(data.compression).eligibleCount)} réponses texte
          volumineuses évaluables. Cache :{" "}
          {value(record(data.cache).evaluatedCount)}/
          {value(record(data.cache).eligibleCount)} ressources statiques
          évaluables. {value(record(data.cache).unavailableCount)} politiques
          non évaluables.
        </p>
        <p className="mt-2 text-sm text-white/45">
          HTML personnalisé, no-store/private, images déjà compressées et petits
          contenus ne sont pas soumis à une obligation de cache public ou de
          compression.
        </p>
        <p className="mt-4 font-semibold text-white/70">
          Ressources les plus lourdes connues
        </p>
        {list(resources.heavy, 10).length ? (
          <ul className="mt-2 space-y-2 text-sm">
            {list(resources.heavy, 10).map((r, i) => (
              <li key={i} className="break-all text-white/60">
                {sanitizeReportUrl(text(r.url))} · {bytes(r.encodedBodyBytes)}{" "}
                (corps encodé) · {text(r.contentType, 128)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-white/45">
            Aucun poids reçu suffisant pour classer les ressources.
          </p>
        )}
        <p className="mt-4 font-semibold text-white/70">
          Chronologie critique observée
        </p>
        <ul className="mt-2 space-y-2 text-sm">
          {list(resources.criticalTimeline, 20).map((r, i) => (
            <li key={i} className="break-all text-white/60">
              {sanitizeReportUrl(text(r.url))} · {value(r.startMs, " ms")} →{" "}
              {value(r.endMs, " ms")}
              {r.blocked ? " · bloquée" : ""}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-white/45">
          Les durées qui se chevauchent ne s’additionnent pas comme un temps de
          blocage.
        </p>
        <ul className="mt-2 space-y-2 text-sm">
          {list(resources.origins, 12).map((o, i) => (
            <li key={i} className="break-all text-white/60">
              {sanitizeReportUrl(text(o.origin))} ·{" "}
              {bytes(o.knownTransferBytes)} · {value(o.resourceCount)}{" "}
              ressources · intervalle {value(o.firstStartMs, " ms")} →{" "}
              {value(o.lastEndMs, " ms")}
            </li>
          ))}
        </ul>
        <p className="mt-4 font-semibold text-white/70">Images observées</p>
        <ul className="mt-2 space-y-2 text-sm">
          {list(data.images, 40).map((image, i) => (
            <li key={i} className="break-all text-white/60">
              {sanitizeReportUrl(text(image.url))} · naturelle{" "}
              {value(image.naturalWidth)} × {value(image.naturalHeight)} ·
              affichée {value(image.displayedWidth)} ×{" "}
              {value(image.displayedHeight)} · {bytes(image.encodedBodyBytes)} ·{" "}
              {text(image.contentType, 128)}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-white/45">
        Mesures de page et de fenêtre, sans données terrain ni validation
        globale des Core Web Vitals. La performance n’entre pas dans le Score
        Deep de sécurité.
      </p>
    </div>
  );
}
