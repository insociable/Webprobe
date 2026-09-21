# Agency Site Monitor

Nom de travail d'un SaaS B2B de surveillance de sites destiné aux agences,
freelances et prestataires qui gèrent plusieurs sites clients.

## État

Le dépôt contient le socle technique du pilote :

- application web et API avec Next.js ;
- worker de scans séparé et file de tâches BullMQ ;
- contrats de données partagés et validés avec Zod ;
- garde-fous SSRF testés avant toute navigation ;
- PostgreSQL, Valkey et Mailpit sous Docker Compose ;
- commandes communes avec pnpm et Turborepo.

Aucun environnement de production n'est encore exposé.

## Pilote fonctionnel

La première tranche verticale doit permettre :

1. de créer une organisation et un site vérifié ;
2. de lancer un scan manuel ou hebdomadaire ;
3. de contrôler HTTP, TLS, en-têtes, liens, JavaScript et accessibilité ;
4. de conserver les résultats et une capture ;
5. d'afficher les différences depuis le scan précédent ;
6. d'envoyer un rapport de marque par e-mail.

La limite initiale est volontaire : quelques agences pilotes, vingt sites
environ et un nombre de pages plafonné par scan.

## Hors périmètre initial

- pentest et scan agressif de vulnérabilités ;
- réseaux internes ou sites nécessitant un mot de passe ;
- crawl massif et soumission de formulaires ;
- applications mobiles ;
- catalogue d'intégrations ;
- microservices et multi-région ;
- certification juridique ou conformité WCAG exhaustive ;
- automatisation par IA sans valeur démontrée.

## Architecture

- `apps/web` : interface, API et orchestration métier ;
- `apps/worker` : consommation des tâches de scan ;
- `packages/contracts` : schémas partagés ;
- `packages/security` : validation des cibles et protections réseau ;
- `packages/db` : accès PostgreSQL et migrations ;
- `infra/compose.yaml` : dépendances locales uniquement.

Le produit reste un monolithe modulaire. Le worker est séparé parce que le
navigateur headless constitue une frontière de sécurité et de ressources.

## Démarrage local

Prérequis : Node.js 24, pnpm 10 et Docker Compose.

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm typecheck
pnpm test
pnpm dev
```

Les ports PostgreSQL, Valkey, SMTP et Mailpit sont publiés uniquement sur
`127.0.0.1`. Le fichier `.env` n'est jamais versionné.

## Invariants de sécurité

- seules les URL HTTP(S) sur ports standards sont acceptées ;
- toutes les réponses DNS doivent être publiques ;
- chaque redirection devra être revalidée avant navigation ;
- les plages privées, locales, link-local, multicast et metadata cloud sont bloquées ;
- les workers Playwright seront isolés et limités en temps, pages et ressources ;
- chaque requête métier portera explicitement l'identifiant d'organisation ;
- aucun secret, mot de passe de site ou contenu sensible ne doit finir dans les logs ;
- les rapports partagés utiliseront des jetons courts, révocables et expirants.

## Vérifications

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Voir `docs/adr/0001-pilot-scope-and-architecture.md` et `SECURITY.md`.
