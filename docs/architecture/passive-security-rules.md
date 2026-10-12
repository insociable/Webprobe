# Sécurité passive Deep — règles 2.0.0

Ce lot précise les diagnostics d'en-têtes, de CSP et de cookies de l'Audit
approfondi, à partir des réponses déjà reçues. Il ne change pas le nombre de
navigations, de requêtes, de handshakes TLS ni le périmètre autorisé.
Le scan standard conserve son moteur ; la sanitation des en-têtes HTTP est
partagée. Performance, accessibilité, SEO, CVE et StackLégal restent indépendants
du Score Deep de sécurité.

## Identités, preuves et couverture

Les identités `deep-security-headers`, `deep-csp` et `deep-cookies` restent
inchangées ; leurs règles passent en `2.0.0`. Aucune migration ni dépendance
n'est ajoutée. Les données JSON sont additives : occurrences CSP, source, limites
et informations de durée. Les allowlists et la séparation des pipelines ne
changent pas.

Les champs CSP appliqués et report-only sont conservés séparément : au plus
quatre politiques de chaque type, 8 192 caractères par champ, 80 directives et
40 sources par directive. Les politiques séparées par une virgule sont
interprétées comme des politiques cumulatives ; la première directive répétée
dans une politique conserve sa priorité. Le nonce est remplacé par un marqueur
sans secret, en conservant la distinction entre syntaxe valide et invalide.
La syntaxe ne démontre ni l'entropie ni le renouvellement d'un nonce.

Les URL absolues, relatives et sans schéma dans les destinations de rapport
perdent leurs paramètres, fragments et identifiants HTTP. Aucune valeur de
cookie n'est conservée. Les preuves techniques affichées sont bornées à 16 ko
et échappées par React ; les données historiques passent aussi par la sanitation
d'affichage.

Une réponse indisponible produit `unavailable`, une preuve tronquée ou une
collection saturée produit `limited`. Ces états participent à la couverture
globale persistée dans la transaction existante. Une analyse terminée avec une
preuve partielle ne devient pas un contrôle favorable. Les constats déjà
observés restent pris en compte dans le score malgré une couverture partielle.

## Diagnostics utiles et contre-exemples

| Sujet             | Interprétation                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HSTS              | Durée exploitable et unique, y compris les chiffres entre guillemets ; zéro ou moins de 180 jours est un point à vérifier                                 |
| nosniff           | Première valeur reconnue selon Fetch ; une répétition de nosniff n'annule pas sa protection                                                               |
| Referrer-Policy   | Dernière valeur reconnue, sans chercher simplement un mot dans l'en-tête                                                                                  |
| Clickjacking      | Priorité de frame-ancestors appliquée sur XFO ; une liste vide bloque les ancêtres ; un seul constat contextuel                                           |
| Isolation         | Valeurs usuelles de COOP/COEP/CORP ; paramètres de reporting conservés comme contexte ; absence seule sans pénalité                                       |
| Clear-Site-Data   | Mécanisme de purge contextuel, incluant prefetchCache/prerenderCache ; aucun accès à un logout                                                            |
| Scripts CSP       | Replis elem/attr/script/default, politiques cumulatives, nonce/hash syntaxiquement valides et strict-dynamic ; unsafe-eval distinct                       |
| Autres directives | none mélangé à d'autres sources ne bloque pas tout ; base-uri/form-action universels restent contextualisés                                               |
| Cookies           | Incohérences certaines des préfixes et de SameSite=None/Secure ; finalité de session à confirmer, sans exiger HttpOnly pour un cookie CSRF lisible par JS |
| Portée et durée   | Domaine parent et durée supérieure à 400 jours comme points contextuels ; Max-Age entier prioritaire sur Expires                                          |

Le diagnostic CSP concerne les champs de la réponse HTTP finale. Il ne
constitue pas une simulation complète de toutes les combinaisons de sources ni
une exploration des CSP des autres pages ou des politiques ajoutées au DOM.
Les indications de framing ne démontrent pas une exploitation.
Le seuil de durée d'un cookie est un seuil de revue technique, sans qualification
juridique ni conclusion certaine sur son rôle.

## Rapports, historique et retour arrière

Le rapport Deep privé et son impression réutilisent le même composant. Les
preuves ont une source, une date et une version ; remédiations et détails
techniques restent repliables. Le partage Deep n'est pas offert par le parcours
actuel ; ce lot n'élargit pas sa diffusion.

Le score affiche la version des règles. Les contrôles historiques v1 gardent
leur calcul antérieur ; les nouvelles règles ne réévaluent pas leurs preuves.
Les comparaisons de scores requièrent une même version. Les comparaisons
standard et le suivi de remédiation ne sont pas réécrits par ces contrôles Deep.
Les anciens constats CSP restent lisibles ; les anciens codes retirés de
l'analyse v2 ne sont pas effacés des preuves historiques.

Le retour au code précédent ne requiert aucun retour de schéma et conserve les
preuves JSON. L'ancien lecteur peut ignorer les nouveaux détails de couverture
et de règles : réactiver la release v2 est nécessaire pour retrouver leur
interprétation précise. Ne jamais reconstruire la release actuellement servie.

## Validation de la reprise du 12 octobre 2026

Base du diff : `7bf756b4314326d2f773f3ce8306eb6902b43954`.

La revue manuelle couvre le diff et ses dépendances de transport, persistance,
autorisation et affichage. Le workflow automatisé Codex Security n'était pas
exposé sur cet hôte ; son fichier de préflight référencé par la compétence
n'était pas accessible. Aucun scan Codex Security finalisé ni absence générale
de vulnérabilité n'est annoncé.

Tests de diagnostics et de rendu réussis ; 35 tests d'intégration ciblés
réellement exécutés dans une base PostgreSQL temporaire et Valkey DB 15 via
le test-gate du dépôt. Ils couvrent le lease/fencing, l'abort, la reprise
BullMQ, la persistance de la couverture v2 et les transports gardés.
Chromium conserve sa sandbox. Les fixtures CSP et cookies interceptent les
requêtes autorisées sans connexion à un site tiers ; aucun clic de consentement
ni soumission de formulaire n'est ajouté.

Le cas d'intégration initial a correctement refusé une fixture sans comptage
des octets. La fixture a été corrigée pour satisfaire le transport gardé,
puis la suite a été relancée avec succès ; aucun garde n'a été désactivé.

Mesures locales des trois analyseurs seuls, hors collecte et compilation,
moyenne de 200 itérations par fixture :

| Fixture   | v1, ms | v2, ms | Preuves v1, octets | Preuves v2, octets | Requêtes d'analyse |
| --------- | -----: | -----: | -----------------: | -----------------: | -----------------: |
| Nominale  |  0,035 |  0,081 |              3 181 |              3 565 |                  0 |
| Défaut    |  0,013 |  0,053 |              3 512 |              4 854 |                  0 |
| Partielle |  0,013 |  0,346 |              5 337 |              6 726 |                  0 |

Ces mesures ne sont pas une estimation de la durée totale d'un scan en production.
Format, lint, typecheck et build sont vérifiés sur la branche de revue ;
la CI doit encore être contrôlée sur le SHA final de la PR.
L'activation de production reste réservée au GO explicite du lot.
La délégation installée ne crée pas les dossiers de releases production ;
cette préparation nécessite l'administrateur de la VM.

## Sources de sémantique

- [CSP Level 3](https://www.w3.org/TR/CSP3/)
- [Fetch — nosniff](https://fetch.spec.whatwg.org/#x-content-type-options-header)
- [RFC 6797 — HSTS](https://www.rfc-editor.org/rfc/rfc6797)
- [Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy)
- [Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- [Clear-Site-Data](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data)
