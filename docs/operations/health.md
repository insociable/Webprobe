# Santé et diagnostics

## Endpoints publics

- `GET /api/health/live` : vérifie uniquement que le processus Web répond ;
- `GET /api/health/ready` : vérifie les dépendances nécessaires au service ;
- `GET /api/health` : alias de compatibilité de l'état de disponibilité.

L'état de disponibilité renvoie HTTP 503 lorsqu'un composant requis est indisponible. La réponse publique reste volontairement synthétique et n'expose pas les détails métier des organisations ou des scans.

## Signal de vie du worker

Le worker publie périodiquement dans Valkey un état de santé avec expiration. Un signal de vie absent ou périmé fait échouer l'état de disponibilité.

Les métriques internes comprennent notamment :

- états BullMQ et backlog ;
- scans en cours ou anciens ;
- compteurs Deep séparés ;
- succès et échecs récents ;
- état des dispatches ;
- PostgreSQL ;
- Valkey et la file ;
- Chromium.

Chromium est sondé périodiquement par lancement/fermeture d'un navigateur sans navigation vers une cible.

## Diagnostic local

Depuis la racine :

```bash
pnpm --filter @agency-saas/worker diagnostics
```

Pour la production :

```bash
curl -fsS https://webprobe.fr/api/health/ready
systemctl is-active agency-saas-web.service
systemctl is-active agency-saas-worker.service
```

Les métriques détaillées ne doivent pas être exposées publiquement sans besoin explicite.
