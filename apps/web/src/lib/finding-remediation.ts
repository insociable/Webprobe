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
    summary: "WebProbe n’a pas pu joindre correctement la cible.",
    steps: [
      "Contrôlez DNS, pare-feu, CDN, reverse proxy et disponibilité de l’hébergement.",
      "Vérifiez que le site est joignable depuis Internet et pas uniquement depuis un réseau privé.",
      "Examinez les journaux réseau et applicatifs au moment de l’échec.",
    ],
    verification:
      "Relancez le scan depuis WebProbe après correction de la connectivité.",
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
  const remediations: Record<string, FindingRemediation> = {
    region: {
      title: "Rattacher le contenu aux zones structurelles de la page",
      summary:
        "La règle region signale qu'une partie du contenu visible se trouve en dehors des landmarks structurants de la page. Les lecteurs d'écran utilisent ces zones pour se déplacer rapidement entre le contenu principal, la navigation, l'en-tête, le pied de page ou les contenus complémentaires.",
      steps: [
        "Repérez les blocs signalés et identifiez leur rôle réel : contenu principal, navigation, en-tête, pied de page ou contenu complémentaire.",
        "Placez le contenu principal dans un élément <main> unique. Utilisez <nav>, <header>, <footer> et <aside> uniquement lorsque leur rôle sémantique correspond réellement au contenu.",
        "Évitez de créer des landmarks uniquement pour satisfaire le test : la structure doit rester simple, cohérente et refléter l'organisation visuelle de la page.",
        "Si plusieurs landmarks du même type sont nécessaires, donnez-leur un nom accessible distinct avec aria-label ou aria-labelledby.",
      ],
      verification:
        "Naviguez dans la liste des landmarks avec un lecteur d'écran ou les outils d'accessibilité du navigateur, puis relancez le scan. Les contenus utiles ne doivent plus rester hors de toute zone structurelle.",
    },
    "landmark-one-main": {
      title: "Conserver une seule zone principale <main>",
      summary:
        "Une page doit exposer un contenu principal clairement identifiable. La règle échoue lorsqu'aucun landmark main n'est disponible, ou lorsque plusieurs zones principales sont présentes en même temps.",
      steps: [
        "Dans le layout global, identifiez le conteneur qui porte le contenu central propre à la page et utilisez un seul élément <main> pour ce rôle.",
        "Supprimez les <main> imbriqués ou dupliqués dans les composants enfants. Dans une SPA, le composant de layout doit généralement porter le <main>, pas chaque sous-composant.",
        "Si une zone doit rester dans le DOM mais ne représente pas le contenu principal courant, utilisez un conteneur sémantique adapté plutôt qu'un second <main>.",
        "Vérifiez également qu'aucun style responsive ne rend simultanément visibles deux variantes de <main>.",
      ],
      verification:
        "Inspectez l'arbre d'accessibilité : un seul landmark main doit être exposé et contenir le contenu principal de la page. Relancez ensuite le scan.",
    },
    "color-contrast": {
      title: "Rétablir un contraste lisible entre texte et arrière-plan",
      summary:
        "Le contraste mesuré est insuffisant pour certains textes ou composants. En niveau AA, le texte courant vise généralement un ratio d'au moins 4,5:1 et le grand texte 3:1.",
      steps: [
        "Repérez les éléments concernés et relevez les couleurs réelles du texte et de l'arrière-plan, y compris après transparence ou superposition.",
        "Ajustez en priorité la couleur du texte ou du fond. Augmenter uniquement la graisse ne suffit pas toujours à atteindre le ratio requis.",
        "Vérifiez les variantes hover, focus, disabled, liens visités, badges, placeholders et les thèmes clair/sombre si le site en possède plusieurs.",
        "Centralisez la correction dans les variables CSS ou le composant source lorsqu'une même combinaison de couleurs est réutilisée sur plusieurs pages.",
      ],
      verification:
        "Contrôlez les ratios avec les DevTools ou un outil de contraste, puis relancez le scan. Vérifiez aussi manuellement les états interactifs qui ne sont pas toujours visibles au chargement initial.",
    },
    "heading-order": {
      title: "Rétablir une hiérarchie logique des titres",
      summary:
        "Les titres structurent la page pour les lecteurs d'écran, les moteurs de recherche et la lecture visuelle. Un saut de niveau ou un titre choisi uniquement pour sa taille peut rendre cette structure difficile à comprendre.",
      steps: [
        "Identifiez le titre principal de la page puis organisez les sections dans un ordre logique : h1 pour le sujet principal, h2 pour les grandes sections, h3 pour leurs sous-sections, etc.",
        "Évitez les sauts artificiels de h2 vers h4 lorsqu'aucun niveau intermédiaire n'existe dans la structure du contenu.",
        "Ne choisissez pas un niveau de titre pour obtenir une taille visuelle : utilisez le CSS pour la présentation et le HTML pour la structure.",
        "Corrigez le composant réutilisé si la même rupture de hiérarchie apparaît sur plusieurs pages.",
      ],
      verification:
        "Parcourez l'arbre des titres dans les DevTools ou avec un lecteur d'écran et vérifiez que la structure reste compréhensible sans regarder la mise en page. Relancez ensuite le scan.",
    },
    "image-alt": {
      title: "Fournir une alternative textuelle adaptée aux images",
      summary:
        "Une image informative doit transmettre une information équivalente lorsqu'elle n'est pas visible. Les images purement décoratives doivent au contraire être ignorées par les technologies d'assistance.",
      steps: [
        "Pour une image informative, renseignez un attribut alt court qui décrit sa fonction ou l'information utile, sans répéter inutilement le texte voisin.",
        'Pour une image décorative, utilisez alt="" afin qu\'elle ne soit pas annoncée comme un contenu utile.',
        "Pour les images complexes, fournissez une explication plus détaillée à proximité ou via une description associée.",
      ],
      verification:
        "Désactivez temporairement les images ou inspectez l'arbre d'accessibilité pour vérifier que le sens de la page reste compréhensible, puis relancez le scan.",
    },
    "button-name": {
      title: "Donner un nom accessible à chaque bouton",
      summary:
        "Un bouton uniquement représenté par une icône ou mal étiqueté peut être annoncé comme 'bouton' sans indication de son action.",
      steps: [
        "Ajoutez un texte visible lorsque c'est possible ; sinon fournissez un aria-label ou aria-labelledby qui décrit clairement l'action.",
        "Vérifiez que le nom accessible correspond à l'action réelle, par exemple 'Fermer le menu' plutôt qu'un libellé vague comme 'Action'.",
        "Évitez de masquer avec aria-hidden le seul contenu qui donne son nom au bouton.",
      ],
      verification:
        "Inspectez le nom accessible dans les DevTools ou parcourez les boutons avec un lecteur d'écran, puis relancez le scan.",
    },
    "link-name": {
      title: "Donner un libellé compréhensible à chaque lien",
      summary:
        "Un lien vide, uniquement visuel ou dont le nom accessible ne décrit pas sa destination peut devenir incompréhensible lorsqu'il est parcouru hors contexte.",
      steps: [
        "Ajoutez un texte de lien explicite ou un nom accessible cohérent lorsque le lien est uniquement constitué d'une icône ou d'une image.",
        "Évitez les libellés génériques répétés comme 'cliquez ici' lorsque la destination peut être nommée directement.",
        "Vérifiez que les images utilisées comme liens possèdent une alternative textuelle qui décrit la destination.",
      ],
      verification:
        "Parcourez la liste des liens avec un lecteur d'écran : chaque destination doit être identifiable sans lire le paragraphe environnant. Relancez ensuite le scan.",
    },
    "html-has-lang": {
      title: "Déclarer la langue principale du document",
      summary:
        "La langue déclarée permet notamment aux lecteurs d'écran de choisir la bonne prononciation et aux navigateurs de mieux interpréter le contenu.",
      steps: [
        "Ajoutez l'attribut lang sur l'élément <html>, par exemple <html lang=\"fr\"> pour une page principalement en français.",
        "Si une portion importante de contenu change de langue, utilisez également lang sur le conteneur concerné.",
        "Vérifiez que le framework ou le CMS ne remplace pas cette valeur au rendu final.",
      ],
      verification:
        "Inspectez le HTML effectivement servi par le navigateur puis relancez le scan. La valeur lang doit correspondre à la langue principale de la page.",
    },
    "document-title": {
      title: "Définir un titre de document explicite",
      summary:
        "Le contenu de <title> permet d'identifier rapidement la page dans un onglet, l'historique, les favoris et les technologies d'assistance.",
      steps: [
        "Ajoutez un <title> non vide et spécifique à la page dans le <head> du document.",
        "Évitez de réutiliser exactement le même titre sur toutes les pages ; incluez le sujet principal et, si utile, le nom du site.",
        "Vérifiez le titre final après rendu côté serveur ou client si le framework le génère dynamiquement.",
      ],
      verification:
        "Contrôlez le titre affiché dans l'onglet et dans le DOM final, puis relancez le scan.",
    },
    label: {
      title: "Associer un libellé accessible aux champs de formulaire",
      summary:
        "Un champ sans libellé associé peut être annoncé uniquement par son type ou son placeholder, ce qui rend sa fonction ambiguë.",
      steps: [
        "Associez un élément <label> au champ avec for/id, ou englober directement le contrôle dans le label.",
        "Lorsque le design ne permet pas de label visible, utilisez aria-label ou aria-labelledby de façon explicite plutôt qu'un placeholder comme seul libellé.",
        "Vérifiez aussi les champs générés par les composants de recherche, filtres, newsletter et formulaires modaux.",
      ],
      verification:
        "Inspectez le nom accessible de chaque champ dans les DevTools ou avec un lecteur d'écran puis relancez le scan.",
    },
    "page-has-heading-one": {
      title: "Ajouter un titre principal H1 à la page",
      summary:
        "Un H1 explicite aide à identifier rapidement le sujet principal de la page et fournit un point d'entrée clair dans la hiérarchie des titres.",
      steps: [
        "Ajoutez un H1 qui décrit le sujet principal de la page, idéalement près du début du contenu principal.",
        "Évitez d'utiliser le logo ou le nom du site comme H1 identique sur toutes les pages si un titre de page plus précis existe.",
        "Conservez ensuite une hiérarchie h2/h3 cohérente pour les sections et sous-sections.",
      ],
      verification:
        "Vérifiez l'arbre des titres et assurez-vous qu'un H1 pertinent est exposé, puis relancez le scan.",
    },
    "landmark-unique": {
      title: "Distinguer les landmarks de même type",
      summary:
        "Lorsque plusieurs zones de navigation ou landmarks similaires existent, chacune doit pouvoir être distinguée afin qu'un utilisateur sache vers laquelle il se déplace.",
      steps: [
        "Identifiez les landmarks de même type présents simultanément sur la page.",
        "Donnez-leur un nom accessible distinct via aria-label ou aria-labelledby, par exemple 'Navigation principale' et 'Navigation pied de page'.",
        "Supprimez les landmarks redondants lorsqu'ils ne représentent pas réellement des zones fonctionnelles distinctes.",
      ],
      verification:
        "Parcourez la liste des landmarks avec un lecteur d'écran ou les DevTools et vérifiez que chaque zone est identifiable sans ambiguïté, puis relancez le scan.",
    },
  };

  const exact = remediations[ruleId];
  if (exact) {
    return exact;
  }

  return {
    title: `Corriger la règle d'accessibilité ${ruleId}`,
    summary:
      `Le contrôle automatisé ${ruleId} a détecté une structure ou un composant qui ne respecte pas le comportement attendu. ` +
      "Le bon correctif consiste à comprendre le rôle du composant source puis à corriger ce composant, plutôt qu'à masquer le signal sur chaque page.",
    steps: [
      "Repérez d'abord les pages concernées puis le composant commun qui génère le défaut. Si le problème apparaît sur plusieurs URL, commencez par le layout ou le composant partagé.",
      `Consultez le code associé à la règle ${ruleId} et inspectez le nom, le rôle, les attributs ARIA et la structure HTML réellement exposés dans l'arbre d'accessibilité.`,
      "Corrigez la sémantique HTML native en priorité. N'ajoutez des attributs ARIA que lorsqu'un élément HTML natif ne couvre pas correctement le besoin.",
      "Testez la correction au clavier et dans l'arbre d'accessibilité du navigateur avant de la généraliser à toutes les pages.",
    ],
    verification: `Relancez le scan et confirmez que la règle ${ruleId} disparaît sur toutes les pages concernées sans introduire de nouvelle régression d'accessibilité.`,
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
        "La mesure de laboratoire dépasse le seuil retenu par WebProbe pour cette métrique.",
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
