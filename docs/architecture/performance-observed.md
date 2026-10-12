# Performance observée — lot 2

## Périmètre et versions

Le lot part de main `6d102031c9ca5fe6d4291d27eeaa5606d5483f24`, après la PR #92 de sécurité passive et la PR #91 de dons Bitcoin. Il ajoute `deep-performance` version `1.0.0`, avec des métriques version `2.0.0`. Le scanner standard réutilise les mêmes primitives de mesure, sans fusionner les deux pipelines. Les profils, pages, requêtes et budgets serveur sont inchangés.

Le contrôle Deep ne participe pas au Score Deep de sécurité. Performance, accessibilité, SEO et CVE restent distincts. Les règles sécurité du lot 1 restent en version 2.0.0 et leur score est inchangé.

## Collecte

La collecte est installée par `page.addInitScript` avant la navigation, dans la page déjà isolée et gardée. En Deep, un échec ou un timeout d’installation interdit de présenter un snapshot comme une mesure instrumentée. Aucun navigateur, contexte, chargement de tiers ou requête cible supplémentaires n’est créé.

Les mesures se terminent au snapshot, après l’observation préexistante des cookies et avant les autres observations DOM finales en Deep. Aucun délai d’attente dédié n’a été ajouté. La durée reste comprise dans les délais, le budget et le lease. Les observateurs vident leurs entrées en attente puis sont déconnectés ; une deuxième lecture conserve la même fin de fenêtre. Abort et fermeture du contexte mettent fin à la collecte.

| Mesure                    | Définition et limite                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TTFB                      | responseStart − requestStart du document ; DNS et connexion précédents sont exclus, définition affichée                                                          |
| FCP                       | entrée first-contentful-paint dans la fenêtre, ou null avec motif                                                                                                |
| LCP                       | dernier candidat observé avant le snapshot, pas une valeur finale de tout le parcours visiteur                                                                   |
| CLS                       | maximum des fenêtres de session, intervalle strictement inférieur à 1 seconde et durée strictement inférieure à 5 secondes ; entrées avec hadRecentInput exclues |
| Blocage du thread observé | somme de max(0, durée − 50 ms) des tâches longues entre navigation et snapshot ; aucun TBT Lighthouse revendiqué                                                 |
| INP                       | null, motif no-user-interaction ; aucun clic, frappe ni interaction synthétique                                                                                  |

Un zéro est permis pour CLS ou blocage uniquement avec un observateur supporté et une fenêtre observée. Une API manquante, une page cachée, une limite d’entrées ou une donnée non finie ne constitue pas un résultat favorable. Les mesures sont celles du navigateur, de la VM, du viewport et du proxy de WebProbe. Aucun percentile, donnée terrain ou validation globale des Core Web Vitals n’est fourni.

## Ressources, tailles et contexte

Les réponses et requêtes déjà reçues fournissent les métadonnées. Les tailles Playwright sont lues après requestfinished en Deep ; un total reçu ambigu à zéro n’est pas conservé comme transfert gratuit. Le standard conserve sa source request.sizes, avec ses limites de collecte signalées.

Les catégories de taille restent séparées :

- transfert connu, en-têtes inclus ;
- corps encodé ;
- corps décodé de Resource Timing, lorsque observable ;
- Content-Length déclaré, qui ne prouve pas le volume reçu.

Chaque total indique le nombre de tailles connues et le nombre observé ; absence de taille connue donne null. Les zéros ambigus de Resource Timing restent inconnus, avec un motif de cache/restriction. Une URL assainie correspondant à plusieurs requêtes ou variantes ne reçoit pas arbitrairement le timing d’une autre requête. La saturation interdit aussi ce rapprochement.

Le résumé par origine fournit les poids connus, les compteurs et l’intervalle premier début → dernière fin. Les durées qui se chevauchent ne sont jamais additionnées comme un temps de blocage total. Le détail affiche au plus dix ressources lourdes, vingt ressources critiques et douze origines. Les images indiquent dimensions naturelles/affichées, format et poids lorsqu’observables ; le conseil de surdimensionnement tient compte du ratio de pixels et exige un poids connu significatif. Aucun format n’est imposé et aucune variante n’est téléchargée.

Les tiers hors périmètre restent bloqués. Leur nombre, les erreurs, les tailles inconnues et la saturation rendent la couverture limitée ; une page partiellement chargée n’obtient pas un verdict global de rapidité.

## Cache et compression

La compression est évaluée seulement pour du texte identifié, avec un corps observé suffisamment volumineux (au moins 1 024 octets) et une preuve de négociation disponible. Les JPEG, WebP, archives, petits corps et types inconnus ne subissent pas de recommandation universelle. Les codings inconnus ou empilés restent non évaluables ; q=0 n’est pas une négociation positive.

Le cache vise les ressources statiques observées, sans réclamer un cache public pour HTML personnalisé, XHR ou contenu sensible. private, no-store et no-cache sont respectés. Une fraîcheur max-age ou Expires suffisante peut rendre ETag inutile. Le format expose les nombres éligibles, évaluables et non évaluables ; un zéro de constat ne signifie pas que des headers absents ont été validés.

Seules les directives Cache-Control reconnues, les types MIME, les encodages reconnus, une date Expires valide et la présence d’ETag sont conservés. Les valeurs d’ETag, paramètres arbitraires et headers complets ne sont pas stockés. Une politique tronquée ou trop longue reste non évaluable. Credentials, paramètres et fragments d’URL sont retirés avant persistance.

## Bornes et persistance

- Au plus 1 000 entrées par observateur, puis saturation visible et arrêt de cet observateur.
- Buffer Resource Timing de 120 entrées, 120 ressources de réponse retenues et 20 images.
- Métadonnées de réponse et tailles : deux collections bornées à 120 tâches, avec attente abortable bornée par le temps restant.
- URL au plus 512 caractères, type MIME 128, directives de cache 256 et navigateur 192.
- Résultat Deep maximal testé sous 65 536 octets ; fixture saturée à 37 428 octets.
- Le standard conserve les mesures de toutes ses pages analysées mais persiste les détails de cinq pages au maximum, avec compteur total visible.

Les données sont enregistrées dans les JSON existants et scan_check_runs, au sein de la transaction fenced. Les couvertures limited/unavailable de deep-performance alimentent v3Coverage même si la première version du contrôle est 1.0.0. Aucune migration ni dépendance n’est ajoutée.

## Historique, suivi et rapports

Les rapports existants sans métriques v2 gardent leur lecture et leur score. Les comparaisons excluent les évolutions de performance entre versions incompatibles, y compris les fingerprints communs, et l’expliquent dans la vue privée et partagée standard. Les autres catégories restent comparées normalement.

Le suivi de remédiation recroise la version du scan qui a réellement observé le constat. Une absence sous une autre version ne suggère pas silencieusement « corrigé ». Les incidents d’alerte anciens ne sont pas clôturés comme des récupérations sur une métrique incompatible.

| Identité                         | Traitement                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| deep-performance                 | nouveau contrôle passif, sans poids de sécurité                                                                     |
| performance.tbt.high             | conservé dans les anciens rapports et suivis ; aucune réévaluation rétroactive                                      |
| performance.thread-blocking.high | nouveau signal standard pour le blocage observé v2 ; une seule règle de blocage produit un constat par page/version |

Les décisions de suivi historiques sont préservées. Un ancien suivi de blocage peut nécessiter une revue humaine lors du changement de définition ; aucune suppression ou migration implicite n’est effectuée. Un signal de la nouvelle version peut ensuite être suivi normalement.

Le rapport Deep privé et son impression rendent les métriques, limites, ressources et remédiations. Les surfaces standard privées, partagées et imprimables utilisent le même composant de présentation. Le partage Deep demeure désactivé. Aucun nouveau accès aux rapports ou aux données d’un autre tenant n’est accordé.

## Vérifications et coût

Les contre-exemples couvrent les fenêtres CLS, leur frontière, le dernier LCP, les APIs non supportées, la finalisation, les tailles/headers inconnus, négociation q=0, contenus déjà compressés, cache privé/frais, ambiguïtés d’URL, saturation, abort et historique. Une fixture dans Chromium avec sandbox et garde de production prouve l’installation avant le script initial, CLS stable vs déplacement et tiers bloqué ; seule la réponse statique autorisée est fournie, sans connexion cible.

La revue est limitée au diff et à ses chemins de transport, persistance, tenant et rendu. La compétence security-diff-scan a été consultée ; ses outils de scan/preflight ne sont pas exposés dans cet environnement. La revue manuelle ne constitue pas un scan Codex Security finalisé ni une garantie générale d’absence de vulnérabilité.

Mesure locale, 500 analyses par fixture : environ 0,013–0,024 ms pour nominal/défaut/partiel, 0,908 ms pour saturation, après indexation des rapprochements. L’ancienne implémentation de la boucle de rapprochement du candidat avait coûté 45,9 ms sur cette fixture ; elle a été corrigée. Les tailles observées sont de 2 039 à 37 428 octets, hors enveloppe scan complète. Les deltas heap après GC de ce processus incluent le warmup et ne décrivent pas le pic Chromium.

Comparaison navigateur sur une fixture stable, deux runs par version : durée 3 082–3 116 ms avant et 3 074–3 103 ms après, une même requête de fixture et zéro connexion cible. RSS de l’arbre du contrôleur de test et Chromium : environ 635–641 Mio avant et 641–645 Mio après, différence moyenne d’environ 4,8 Mio. Ce petit échantillon ne mesure pas la consommation de production ni une amélioration significative de durée.

Rendus de fixtures à 390 et 1 440 px sans débordement horizontal ; PDF de couverture partielle inspecté, métriques/version/INP et limites visibles. Ces vérifications emploient des données synthétiques, pas des rapports personnels.

Sources primaires : [CLS](https://web.dev/articles/cls), [INP](https://web.dev/articles/inp), [Web Vitals](https://web.dev/articles/vitals), [Resource Timing transferSize](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/transferSize), [Playwright request.sizes](https://playwright.dev/docs/api/class-request#request-sizes).

## Activation et retour arrière

La collecte est activée par défaut. Le réglage de processus serveur `WEBPROBE_PERFORMANCE_COLLECTION=disabled` permet de revenir fonctionnellement au lot 1 tout en conservant les gardes de comparaison/résolution des métriques v2. Il est lu uniquement depuis l'environnement du worker, jamais depuis une URL, un payload BullMQ ou la cible. Aucun secret nouveau n'est nécessaire.

En désactivation, aucun observateur performance n'est installé ou lu. Deep n'évalue plus le contrôle performance et conserve une preuve unavailable/collection-disabled ; les autres contrôles, transports et budgets restent actifs. Le standard marque sa couverture performance indisponible. Les rapports v2 déjà persistés restent lisibles, sans réévaluation.

Procédure de repli après autorisation : conserver le binaire du lot, modifier ce réglage dans le fichier d'environnement du périmètre concerné, comme des données (ne pas sourcer .env), puis réactiver le même nom de release/SHA avec `webprobe-ops activate`. Le helper versionné contrôle les scans actifs, conserve l'état précédent, redémarre les unités et vérifie ready. Restaurer ensuite le réglage par la même procédure pour reprendre la collecte.

Le retour applicatif vers le SHA précédent demeure possible avant toute donnée standard v2. Après production de telles données, ne pas revenir aveuglément à l'ancien worker : il ne connaît pas les gardes de version et peut suggérer des résolutions incompatibles. Préférer le repli fonctionnel ci-dessus. Aucune table ni donnée de métrique ne doit être supprimée et aucune restauration de base n'est nécessaire pour ce repli.

Les vérifications exécutées incluent format:check, lint, typage Worker et Web, build, 49 tests d’intégration ciblés PostgreSQL/Valkey, 26 tests ciblés de rendu/score/comparaison et trois fixtures Chromium réellement exécutées. La suite workspace a passé 343 tests Worker (dont les intégrations), 166 Web, 31 sécurité et 26 contrats. Le gate Turbo ne transmet pas RUN_BROWSER_INTEGRATION : ses trois skips navigateur sont donc vérifiés séparément avec ce flag, sans les assimiler à des succès. Les chemins de désactivation ajoutés ensuite ont passé les tests ciblés (14), le typage et les trois fixtures navigateur, et sont revérifiés par la CI du SHA final.
