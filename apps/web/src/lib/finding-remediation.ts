export type FindingRemediation = {
  title: string;
  summary: string;
  steps: string[];
  verification: string;
};

const exactRemediations: Record<string, FindingRemediation> = {
  "security-header.csp.missing": {
    title: "Définir une Content-Security-Policy",
    summary:
      "Ajoutez une politique CSP adaptée aux ressources réellement chargées par le site afin de limiter l’exécution et le chargement de contenu non autorisé.",
    steps: [
      "Inventoriez les scripts, styles, images, polices et domaines tiers utilisés.",
      "Déployez d’abord une politique restrictive en mode Report-Only si le site est complexe.",
      "Passez ensuite à Content-Security-Policy et réduisez autant que possible unsafe-inline et unsafe-eval.",
    ],
    verification:
      "Relancez un scan et vérifiez que l’en-tête Content-Security-Policy est présent sans casser les ressources du site.",
  },
  "security-header.hsts.missing": {
    title: "Activer HSTS sur HTTPS",
    summary:
      "HSTS force les navigateurs à réutiliser HTTPS après la première visite et réduit le risque de downgrade vers HTTP.",
    steps: [
      "Confirmez que le domaine et les sous-domaines concernés fonctionnent tous correctement en HTTPS.",
      "Ajoutez Strict-Transport-Security avec une durée adaptée, par exemple max-age=31536000.",
      "N’ajoutez includeSubDomains ou preload qu’après validation de tous les sous-domaines.",
    ],
    verification:
      "Relancez le scan et contrôlez la présence de Strict-Transport-Security sur la réponse HTTPS.",
  },
  "security-header.permissions-policy.missing": {
    title: "Limiter les fonctionnalités navigateur inutiles",
    summary:
      "Permissions-Policy permet de désactiver explicitement les API sensibles que le site n’utilise pas.",
    steps: [
      "Listez les fonctionnalités réellement nécessaires : caméra, micro, géolocalisation, paiement, capteurs, etc.",
      "Désactivez par défaut les fonctionnalités inutilisées et n’autorisez que les origines nécessaires.",
      "Ajoutez l’en-tête Permissions-Policy au niveau du serveur ou du CDN.",
    ],
    verification:
      "Relancez le scan et vérifiez que Permissions-Policy est présent sur la page principale.",
  },
  "security-header.x-frame-options.missing": {
    title: "Bloquer l’intégration non autorisée en iframe",
    summary:
      "Empêchez un site tiers d’encapsuler la page afin de réduire le risque de clickjacking.",
    steps: [
      "Si aucune intégration iframe n’est nécessaire, utilisez X-Frame-Options: DENY.",
      "Si l’intégration par le même site est nécessaire, utilisez SAMEORIGIN.",
      "Pour un contrôle moderne et plus fin, définissez aussi frame-ancestors dans la CSP.",
    ],
    verification:
      "Relancez le scan et vérifiez la présence de X-Frame-Options ou d’une directive CSP frame-ancestors adaptée.",
  },
  "security-header.x-content-type-options.missing": {
    title: "Désactiver le MIME sniffing",
    summary:
      "Ajoutez X-Content-Type-Options afin d’éviter que le navigateur interprète un type de contenu différemment de celui annoncé.",
    steps: [
      "Ajoutez l’en-tête X-Content-Type-Options: nosniff sur les réponses.",
      "Vérifiez que les Content-Type servis par l’application sont corrects.",
    ],
    verification:
      "Relancez le scan et contrôlez que X-Content-Type-Options vaut nosniff.",
  },
  "security-header.referrer-policy.missing": {
    title: "Définir une Referrer-Policy",
    summary:
      "Contrôlez les informations d’URL transmises aux sites tiers lors de la navigation.",
    steps: [
      "Choisissez une politique adaptée au besoin analytique du site.",
      "strict-origin-when-cross-origin est un point de départ courant pour limiter les détails envoyés entre origines.",
      "Ajoutez l’en-tête Referrer-Policy au serveur ou au CDN.",
    ],
    verification:
      "Relancez le scan et vérifiez que Referrer-Policy est présent.",
  },
  "security-header.x-powered-by.exposed": {
    title: "Masquer l’en-tête X-Powered-By",
    summary:
      "Réduisez l’exposition d’informations techniques inutiles sur la pile applicative.",
    steps: [
      "Désactivez l’en-tête X-Powered-By dans le framework ou le serveur web.",
      "Vérifiez qu’un proxy ou CDN ne le réinjecte pas.",
    ],
    verification:
      "Relancez le scan et contrôlez que l’en-tête n’est plus retourné.",
  },
  "tls.certificate-expiring": {
    title: "Sécuriser le renouvellement du certificat TLS",
    summary:
      "Le certificat approche de son expiration. Vérifiez le renouvellement automatique avant qu’il ne provoque une interruption.",
    steps: [
      "Identifiez l’autorité ou le service qui renouvelle actuellement le certificat.",
      "Contrôlez l’état du renouvellement automatique et les éventuelles erreurs récentes.",
      "Renouvelez manuellement si l’automatisation n’est pas fiable ou si l’échéance devient courte.",
    ],
    verification:
      "Relancez le scan après renouvellement et vérifiez la nouvelle date d’expiration.",
  },
  "tls.connection-failed": {
    title: "Rétablir une chaîne TLS valide",
    summary: "La connexion HTTPS n’a pas pu être validée correctement.",
    steps: [
      "Vérifiez le certificat, le nom de domaine couvert et la chaîne intermédiaire.",
      "Contrôlez les versions TLS et suites cryptographiques servies.",
      "Testez depuis une machine externe pour exclure un problème réseau local.",
    ],
    verification:
      "Relancez le scan jusqu’à obtenir une négociation TLS valide.",
  },
  "availability.timeout": {
    title: "Réduire les délais de réponse",
    summary: "Le site n’a pas répondu dans le délai attendu par le moniteur.",
    steps: [
      "Vérifiez la disponibilité de l’hébergement et les temps de réponse côté serveur.",
      "Contrôlez les dépendances externes, la base de données et les traitements bloquants.",
      "Examinez les journaux autour de l’heure du scan pour identifier une saturation ou un timeout amont.",
    ],
    verification:
      "Relancez le scan et vérifiez qu’une réponse HTTP complète est obtenue dans le délai.",
  },
  "availability.network-error": {
    title: "Rétablir l’accessibilité réseau du site",
    summary: "Agency Monitor n’a pas pu joindre correctement la cible.",
    steps: [
      "Contrôlez DNS, pare-feu, CDN, reverse proxy et disponibilité de l’hébergement.",
      "Vérifiez que le site est joignable depuis Internet et pas uniquement depuis un réseau privé.",
      "Examinez les journaux réseau et applicatifs au moment de l’échec.",
    ],
    verification:
      "Relancez le scan depuis Agency Monitor après correction de la connectivité.",
  },
  "availability.redirect-error": {
    title: "Corriger la chaîne de redirection",
    summary:
      "La navigation rencontre une redirection invalide, excessive ou impossible à suivre.",
    steps: [
      "Inspectez les redirections HTTP entre le domaine demandé et la destination finale.",
      "Supprimez les boucles et les étapes inutiles.",
      "Vérifiez la cohérence HTTP vers HTTPS et www vers domaine racine.",
    ],
    verification:
      "Relancez le scan et contrôlez que la destination finale répond directement avec un statut exploitable.",
  },
  "availability.http-5xx": {
    title: "Corriger l’erreur serveur",
    summary:
      "La cible retourne une erreur HTTP 5xx qui indique un problème côté serveur ou service amont.",
    steps: [
      "Consultez les logs applicatifs et reverse proxy correspondant à l’URL concernée.",
      "Vérifiez les dépendances, ressources système et erreurs de déploiement.",
      "Reproduisez la requête directement sur l’application si un proxy est présent.",
    ],
    verification:
      "Relancez le scan lorsque l’URL retourne de nouveau une réponse 2xx attendue.",
  },
  "availability.http-4xx": {
    title: "Corriger la réponse HTTP en erreur",
    summary:
      "La page supervisée retourne un code 4xx et n’est donc pas accessible comme attendu.",
    steps: [
      "Vérifiez que l’URL existe encore et qu’elle n’exige pas une authentification inattendue.",
      "Corrigez les règles de routage, réécriture ou contrôle d’accès qui bloquent la page.",
      "Si la ressource a été déplacée, mettez en place une redirection permanente cohérente.",
    ],
    verification:
      "Relancez le scan et confirmez une réponse 2xx ou une redirection valide.",
  },
  "availability.http-3xx-final": {
    title: "Terminer la redirection sur une vraie page",
    summary:
      "La destination finale reste une redirection au lieu de servir le contenu attendu.",
    steps: [
      "Contrôlez la dernière règle de redirection et sa destination.",
      "Réduisez les chaînes de redirection et terminez sur une réponse 2xx.",
    ],
    verification:
      "Relancez le scan et vérifiez que l’URL finale sert directement la page.",
  },
  "performance.http-response-slow": {
    title: "Réduire le temps de réponse HTTP",
    summary:
      "Le premier retour du serveur est suffisamment lent pour dégrader la disponibilité perçue et le parcours utilisateur.",
    steps: [
      "Mesurez le temps serveur indépendamment des ressources front-end.",
      "Optimisez les requêtes lentes, traitements synchrones et appels externes.",
      "Utilisez cache, CDN ou rendu pré-calculé lorsque le contenu le permet.",
    ],
    verification:
      "Relancez plusieurs scans et comparez la durée HTTP avant et après correction.",
  },
  "broken-link.http-error": {
    title: "Réparer le lien interne",
    summary:
      "Un lien trouvé pendant le crawl mène vers une page qui retourne une erreur HTTP.",
    steps: [
      "Ouvrez l’URL source indiquée dans les preuves et retrouvez le lien concerné.",
      "Corrigez sa destination ou restaurez la page cible.",
      "Si la page a été déplacée, ajoutez une redirection permanente vers la nouvelle URL.",
    ],
    verification:
      "Relancez le scan et confirmez que le lien mène à une page valide.",
  },
  "broken-link.navigation-failed": {
    title: "Rendre la destination navigable",
    summary:
      "Le navigateur n’a pas pu charger correctement une URL liée depuis une autre page du site.",
    steps: [
      "Vérifiez l’URL et la page source indiquées dans les preuves.",
      "Corrigez le lien, la résolution DNS ou la règle réseau qui empêche la navigation.",
      "Évitez les destinations internes, temporaires ou non accessibles publiquement.",
    ],
    verification:
      "Relancez le scan et confirmez que la navigation aboutit sans erreur.",
  },
  "javascript.uncaught-error": {
    title: "Corriger les erreurs JavaScript non interceptées",
    summary:
      "Le navigateur a observé une ou plusieurs erreurs JavaScript pendant le chargement ou l’utilisation de la page.",
    steps: [
      "Reproduisez la page avec la console du navigateur ouverte.",
      "Corrigez la première erreur non interceptée avant les erreurs en cascade.",
      "Ajoutez une gestion d’erreur explicite autour des appels réseau et composants fragiles.",
    ],
    verification:
      "Relancez le scan et vérifiez que le compteur d’erreurs JavaScript revient à zéro.",
  },
};

function accessibilityRemediation(code: string): FindingRemediation {
  const ruleId = code.replace(/^accessibility\./, "");

  if (ruleId === "color-contrast") {
    return {
      title: "Améliorer le contraste des contenus",
      summary:
        "Certains textes ou composants n’ont pas un contraste suffisant avec leur arrière-plan.",
      steps: [
        "Identifiez les éléments concernés sur la page signalée.",
        "Ajustez couleur du texte, arrière-plan ou graisse afin d’atteindre un contraste lisible.",
        "Vérifiez les états hover, focus, disabled et les variantes responsive.",
      ],
      verification:
        "Relancez le scan d’accessibilité et vérifiez que la règle color-contrast n’est plus signalée.",
    };
  }

  if (ruleId === "heading-order") {
    return {
      title: "Rétablir une hiérarchie de titres cohérente",
      summary:
        "La structure des titres saute ou mélange des niveaux, ce qui gêne la navigation assistée.",
      steps: [
        "Conservez un ordre logique h1, h2, h3 selon la structure du contenu.",
        "N’utilisez pas les niveaux de titre uniquement pour obtenir une taille visuelle.",
      ],
      verification:
        "Relancez le scan et contrôlez que la règle heading-order est résolue.",
    };
  }

  return {
    title: "Corriger la règle d’accessibilité signalée",
    summary: `Le contrôle d’accessibilité ${ruleId} a échoué sur cette page.`,
    steps: [
      "Repérez les éléments concernés à partir de la page et du nombre de nœuds indiqués.",
      "Corrigez le composant source plutôt que chaque occurrence générée si le problème est récurrent.",
      "Testez au clavier et avec les outils d’accessibilité du navigateur avant de relancer le scan.",
    ],
    verification: `Relancez le scan et vérifiez que la règle ${ruleId} n’est plus signalée.`,
  };
}
function scannerV2Remediation(code: string): FindingRemediation | null {
  if (code === "seo.noindex") {
    return {
      title: "Vérifier si le noindex est volontaire",
      summary:
        "La page demande aux moteurs de recherche de ne pas l’indexer. Ce réglage peut être normal pour une page privée, technique ou volontairement exclue, mais il doit être supprimé si la page doit apparaître dans les résultats de recherche.",
      steps: [
        "Passez en revue les URL concernées et confirmez pour chacune si l’exclusion de l’index est intentionnelle.",
        "Si une page doit être indexée, retirez la directive noindex de la balise meta robots ou de l’en-tête X-Robots-Tag.",
        "Si le noindex est volontaire, conservez-le et documentez cette intention afin d’éviter une correction inutile.",
      ],
      verification:
        "Relancez le scan : les pages destinées à être indexées ne doivent plus remonter ce signal, tandis que les exclusions volontaires peuvent rester assumées.",
    };
  }

  if (code.startsWith("seo.")) {
    return {
      title: "Corriger le signal SEO détecté",
      summary:
        "Le scan a identifié un signal SEO déterministe sur cette page. Corrigez la balise ou la directive concernée dans le HTML généré.",
      steps: [
        "Repérez la page et le code SEO indiqués dans le finding.",
        "Corrigez la balise title, meta description, canonical, lang, H1 ou directive robots concernée.",
        "Vérifiez que la valeur finale est cohérente avec l’intention d’indexation de la page.",
      ],
      verification:
        "Relancez le scan et vérifiez que le code SEO concerné n’est plus signalé.",
    };
  }

  if (code.startsWith("network.")) {
    return {
      title: "Corriger la ressource réseau en erreur",
      summary:
        "Une ressource first-party nécessaire au site échoue ou retourne un statut HTTP invalide pendant le chargement.",
      steps: [
        "Identifiez la ressource et son type dans les preuves du finding.",
        "Corrigez son URL, son routage, son déploiement ou la dépendance qui provoque l’échec.",
        "Contrôlez ensuite le chargement depuis un navigateur sans cache.",
      ],
      verification:
        "Relancez le scan et vérifiez que la ressource ne génère plus d’erreur réseau.",
    };
  }

  if (code.startsWith("performance.")) {
    return {
      title: "Optimiser la métrique de performance signalée",
      summary:
        "La mesure de laboratoire dépasse le seuil retenu par Agency Monitor pour cette métrique.",
      steps: [
        "Comparez la valeur observée et le seuil affichés dans les preuves.",
        "Traitez d’abord les ressources ou traitements dominants : serveur, JavaScript, images, CSS, polices ou nombre de requêtes.",
        "Mesurez à nouveau après chaque changement significatif pour éviter les optimisations à l’aveugle.",
      ],
      verification:
        "Relancez plusieurs scans et vérifiez que la métrique repasse sous le seuil d’alerte de façon stable.",
    };
  }

  return null;
}

export function getFindingRemediation(code: string): FindingRemediation | null {
  const exact = exactRemediations[code];
  if (exact) {
    return exact;
  }

  if (code.startsWith("accessibility.")) {
    return accessibilityRemediation(code);
  }

  return scannerV2Remediation(code);
}
