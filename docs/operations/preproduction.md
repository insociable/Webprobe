# Validation en préproduction

La préproduction sert à valider un candidat avant une modification sensible de la production. Elle n'est pas une description de l'état de production ; le guide d’exploitation de la production se trouve dans `docs/operations/production.md`.

## Configuration

Vérifier notamment :

- `DATABASE_URL` et `REDIS_URL` ;
- `BETTER_AUTH_SECRET` ;
- paramètres SMTP ;
- `REPORT_TOKEN_SECRET` distinct ;
- `REPORT_PUBLIC_BASE_URL` ;
- `SCAN_ARTIFACTS_DIR` ;
- Chromium compatible avec Playwright ;
- variables Deep lorsqu'un test Deep est prévu.

## Validation

Avant un GO de déploiement :

1. identifier le SHA exact du candidat ;
2. vérifier les migrations ;
3. exécuter format, lint, typecheck, tests et build selon la portée du changement ;
4. vérifier le test navigateur lorsque le worker ou le réseau sont concernés ;
5. vérifier `/api/health/ready` ;
6. exécuter les parcours fonctionnels touchés ;
7. vérifier les logs sans exposer de secret ;
8. confirmer le plan de retour arrière.

## Réseau

Tester les refus LAN, loopback, metadata cloud, ports non autorisés, DNS rebinding et redirections lorsque le changement touche le moteur de scan.

Le filtrage applicatif reste la première barrière du dépôt ; une politique egress au niveau hôte/conteneur constitue une défense complémentaire.

## Données

Ne pas utiliser la préproduction pour justifier une migration destructrice improvisée.

Les tests de restauration doivent inclure PostgreSQL et les artefacts de `SCAN_ARTIFACTS_DIR`.

## Audit approfondi

Les tests Deep utilisent le même barrière serveur que le code actuel :

- `WEBPROBE_RUNTIME_ENV=preproduction` ;
- `WEBPROBE_INTERNAL_DEEP_WORKER=enabled`.

Le cycle de vie détaillé est documenté dans `v3-deep-activation.md`.
