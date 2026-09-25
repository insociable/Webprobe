# WebProbe

> Audit, monitoring et analyse technique de sites web.

WebProbe analyse des sites web publics afin de faire ressortir des constats techniques sur leur disponibilité, leur configuration HTTP, leur sécurité, leur comportement navigateur, leur accessibilité et certains éléments de performance ou de référencement.

L'instance officielle actuellement déployée est : `https://webprobe.fr`.

## Fonctionnalités principales

### Scan standard

Le Scan standard est destiné au contrôle courant et au monitoring d'un site. Il collecte notamment des informations HTTP, TLS, en-têtes, liens, comportement navigateur, JavaScript, accessibilité et capture visuelle lorsque celle-ci est activée.

Les sites vérifiés peuvent être suivis dans le temps afin de comparer les résultats, planifier des scans et déclencher les notifications prévues par l'application.

### Audit approfondi

L'Audit approfondi utilise le mode interne `verified_deep_audit` et un moteur distinct du parcours standard. Il analyse actuellement dix contrôles :

- observation HTTP ;
- observation navigateur ;
- TLS ;
- en-têtes de sécurité ;
- Content Security Policy ;
- cookies ;
- ressources ;
- endpoints observés ;
- formulaires ;
- métadonnées navigateur.

L'Audit approfondi reste non destructif : il ne soumet pas de formulaire, ne lance pas de recherche par dictionnaire et n'effectue pas de pentest agressif. Son périmètre réseau est strict, les transports sont protégés contre les SSRF et l'exécution est bornée par des budgets de requêtes, pages, octets, DNS, TLS et durée.

Le code de `main` accepte un Audit approfondi sur un site actif déjà vérifié. Lorsqu'un grant Deep DNS dédié existe, il est revalidé avant l'exécution et son identité participe au fencing de l'exécution.

## Score Deep

Le rapport Deep peut afficher un score sur 100 calculé à partir des constats réellement observés. Les contrôles de sécurité ont des pénalités et plafonds plus importants que les contrôles informatifs.

Une couverture incomplète limite le score maximal afin qu'un contrôle non exécuté ne soit pas interprété comme un résultat favorable.

Le Score Deep est un indice de synthèse. Il ne constitue ni un pourcentage de sécurité, ni une preuve d'absence de vulnérabilité, ni une certification.

## Architecture

Le dépôt est un monorepo TypeScript géré avec pnpm et Turborepo.

- `apps/web` : interface Web, API, authentification et orchestration applicative ;
- `apps/worker` : exécution des scans, BullMQ, Chromium et traitements asynchrones ;
- `packages/contracts` : contrats et schémas partagés ;
- `packages/security` : validation des cibles et primitives de sécurité réseau ;
- `packages/db` : schéma PostgreSQL, accès aux données et migrations ;
- `infra/compose.yaml` : dépendances d'infrastructure pour l'environnement local.

PostgreSQL est la source de vérité. Valkey est utilisé par BullMQ et pour l'état opérationnel éphémère. Chromium est piloté avec Playwright par le worker.

## Sécurité

Les principaux invariants sont :

- validation des URL, DNS et adresses IP avant connexion ;
- refus des destinations privées, loopback, link-local, multicast et metadata cloud ;
- revalidation des redirections et épinglage de l'adresse publique validée ;
- périmètre strict pour l'Audit approfondi ;
- Chromium exécuté sans privilège avec sandbox active ;
- proxy et transports applicatifs contrôlés ;
- budgets de réseau, durée et concurrence ;
- lease et fencing PostgreSQL pour les tentatives Deep ;
- isolation des données par organisation ;
- secrets conservés hors du dépôt ;
- artefacts sensibles non servis directement comme fichiers statiques.

Voir `SECURITY.md` pour les détails.

## Installation locale

Prérequis :

- Node.js 24 ;
- pnpm 10 ;
- Docker avec Docker Compose.

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm typecheck
pnpm test
pnpm dev
```

Pour installer Chromium pour le worker :

```bash
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers \
  pnpm --filter @agency-saas/worker exec playwright install chromium
pnpm --filter @agency-saas/worker smoke:browser
```

La configuration est décrite dans `.env.example`. Les secrets réels ne doivent jamais être versionnés.

## Vérifications du dépôt

Les commandes principales sont :

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Les tests d'intégration PostgreSQL et Valkey nécessitent leur environnement dédié. Les modifications purement documentaires ne nécessitent pas systématiquement l'exécution de toute la suite applicative.

## Production

L'instance actuelle est déployée sous `/srv/agency-saas` et exposée sur `https://webprobe.fr`.

Les services principaux sont :

- `agency-saas-web.service` ;
- `agency-saas-worker.service`.

Les procédures d'exploitation, de déploiement, de diagnostic et de retour arrière sont documentées dans `docs/operations/production.md`.

## Coûts d'infrastructure

L'exploitation d'une instance WebProbe nécessite une infrastructure adaptée. Selon l'hébergement retenu, cela peut inclure les coûts d'un serveur ou d'une VM, du domaine, du stockage et des sauvegardes, de l'envoi d'e-mails et d'éventuels services tiers.

## Documentation

- `SECURITY.md` : modèle de sécurité et limites ;
- `docs/architecture/v3-scan-engine.md` : architecture du moteur Deep ;
- `docs/operations/production.md` : guide d’exploitation de la production ;
- `docs/operations/v3-deep-activation.md` : exploitation du mode Deep ;
- `docs/operations/health.md` : santé, disponibilité et diagnostics ;
- `docs/security/public-audit.md` : modèle de sécurité de l’Audit public ;
- `docs/architecture/vulnerability-intelligence.md` : inventaire passif et rapprochement CVE/KEV V3.1.
