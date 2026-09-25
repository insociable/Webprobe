# Architecture du moteur d'Audit approfondi

## Vue d'ensemble

Le mode de scan est persisté dans `scans.scan_mode`. Le worker relit cette valeur en base avant de choisir le pipeline d'exécution : une charge utile BullMQ ne peut donc pas transformer un scan standard en Audit approfondi.

Le mode Deep est `verified_deep_audit`. Son cycle de vie est distinct du traitement V2 utilisé par `public_audit` et `verified_monitoring`.

La barrière serveur autorise actuellement le worker Deep uniquement lorsque :

- `WEBPROBE_RUNTIME_ENV` vaut `preproduction` ou `production` ;
- `WEBPROBE_INTERNAL_DEEP_WORKER=enabled`.

Les données du job ne peuvent pas activer cette barrière.

## Profil et budgets

`apps/worker/src/scan-engine/profiles.ts` définit les plafonds gérés côté serveur.

Le profil Deep borne notamment :

- requêtes HTTP ;
- pages ;
- octets transférés ;
- requêtes DNS ;
- handshakes TLS ;
- opérations actives sûres ;
- requêtes par hostname ;
- durée maximale ;
- timeouts réseau et navigation ;
- redirections ;
- concurrence.

Le chemin interne fournit la liste des contrôles Deep autorisés, puis `deep-candidate.ts` vérifie qu'aucune limite ne dépasse le profil serveur.

## Autorisation

Le site doit être actif, vérifié et conserver la même URL canonique que celle du scan.

Le comportement actuel de `main` prévoit deux situations :

1. aucun grant Deep dédié n'existe : la vérification active du site permet l'autorisation Deep ;
2. un grant Deep DNS existe : il est revalidé et devient une identité de grant liée à l'exécution.

Un grant DNS utilise une preuve TXT, une génération, une date de vérification, une expiration et un état de révocation. La preuve est relue avant l'exécution. Après la résolution DNS, PostgreSQL est relu sous verrou avec une horloge fraîche afin d'éviter une décision fondée sur un état devenu obsolète.

## Périmètre

`scope-guard.ts` n'accorde aucun périmètre implicite à partir d'un simple voisinage DNS ou de domaine.

Le périmètre autorisé est construit à partir de l'URL canonique. Les sous-domaines, ports différents, alias DNS et origines de redirection n'obtiennent pas automatiquement l'autorisation.

Les ressources tierces observées ou bloquées hors périmètre ne doivent pas être confondues avec une navigation principale ayant quitté le périmètre.

## Transports gardés

### HTTP

`guarded-http-transport.ts` applique l'autorisation, le périmètre et les budgets avant la résolution et la connexion.

Le transport réutilise la validation SSRF, épingle l'adresse publique validée et refuse les redirections hors périmètre.

### Navigateur

`guarded-browser-transport.ts` intercepte les requêtes Chromium et les achemine via un proxy local contrôlé.

Le garde vérifie les navigations, redirections, frames, fetch/XHR et sous-ressources. Le proxy revérifie le périmètre avant DNS puis épingle une adresse publique.

Les WebSockets sont fermés et les service workers sont bloqués dans ce pipeline.

## Lease et fencing

Chaque tentative Deep doit obtenir un lease PostgreSQL via `deep-lease.ts` avant le trafic vers le site.

Le lease d'exécution est distinct du lease de remise de tâche `scan_dispatches`.

Chaque tentative possède :

- un identifiant de tentative ;
- un numéro de tentative ;
- un `lease_token` ;
- une date `lease_until`.

Le lease est renouvelé périodiquement. Un watchdog local abort l'exécution lorsque le renouvellement ne peut plus être garanti.

Une tentative ancienne ne peut pas persister ses résultats après perte du lease : la transaction finale vérifie le token, l'état du scan et l'expiration du lease.

Une tentative Deep expirée peut être reprise, dans la limite du nombre maximal de tentatives prévu par le moteur. Un lease actif a priorité sur une observation de file apparemment obsolète.

## Collecte et contrôles

Le pipeline actuel raccorde dix contrôles :

1. `deep-http-observation` — résultat HTTP de base ;
2. `deep-browser-observation` — résultat de navigation et nombre de pages observées ;
3. `deep-tls` — certificat et état TLS disponibles ;
4. `deep-security-headers` — en-têtes de sécurité ;
5. `deep-csp` — Content Security Policy ;
6. `deep-cookies` — attributs des cookies sans leurs valeurs ;
7. `deep-resources` — ressources observées, tiers et blocages ;
8. `deep-endpoints` — endpoints observés sans exploration par dictionnaire ;
9. `deep-forms` — formulaires observés sans soumission ;
10. `deep-browser-meta` — métadonnées navigateur, iframes, SRI et erreurs bornées.

Les contrôles sont passifs : ils consomment les observations produites par les transports et ne reçoivent pas un client réseau arbitraire.

## Persistance et couverture

`check-persistence.ts` persiste les `scan_check_runs` et termine la tentative dans une transaction.

La transaction revérifie :

- le scan ;
- l'organisation et le site ;
- le lease et son token ;
- l'URL canonique ;
- l'état du site ;
- le grant lorsqu'une identité de grant est utilisée.

La couverture est enregistrée dans `summary.v3Coverage` avec :

- nombre total de contrôles ;
- contrôles terminés ;
- contrôles ignorés ;
- contrôles en échec ;
- caractère partiel ;
- raisons de couverture partielle ;
- budget consommé.

Une erreur de transport peut produire des contrôles `skipped` plutôt qu'un faux résultat positif ou négatif.

## Incident, reprise et nouvelle tentative

Le planificateur inspecte les scans Deep restés `running`.

Un lease PostgreSQL encore actif empêche la reprise concurrente, même si l'état BullMQ paraît incohérent.

Lorsque le lease a expiré ou que le job a disparu/échoué de façon terminale, le mécanisme de réconciliation clôt proprement la tentative et le scan avec un code d'erreur explicite.

Le worker distingue les erreurs récupérables des erreurs terminales. Une tentative qui perd son lease ne doit plus être considérée comme propriétaire du scan.

## Migrations

Le socle Deep repose notamment sur les migrations :

- `0014_opposite_triton.sql` ;
- `0015_nervous_madame_hydra.sql` ;
- `0016_lazy_prism.sql` ;
- `0017_public_zombie.sql`.

La migration 0017 rend `deep_audit_authorizations.generation_id` obligatoire et refuse de fabriquer silencieusement une génération pour une ancienne ligne NULL.

Les scripts de retour arrière correspondants se trouvent dans `docs/operations/`. Un retour arrière de schéma doit toujours rester compatible avec la version applicative déployée et les données réellement présentes.
