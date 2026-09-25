# Agency Site Monitor

Nom de travail d'un SaaS B2B de surveillance de sites destiné aux agences,
freelances et prestataires qui gèrent plusieurs sites clients.

## État

Le dépôt contient le socle technique du pilote :

- application web et API avec Next.js ;
- worker de scans séparé et file de tâches BullMQ ;
- contrats de données partagés et validés avec Zod ;
- garde-fous SSRF testés avant toute navigation ;
- runtime Chromium isolé pour crawl interne borné, JavaScript et axe-core ;
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

Pour préparer le runtime navigateur du worker :

```bash
PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers \
  pnpm --filter @agency-saas/worker exec playwright install chromium
pnpm --filter @agency-saas/worker smoke:browser
```

Le cache Chromium local est ignoré par Git. Le smoke charge une cible publique et
vérifie qu'un accès loopback/metadata ne contourne pas le proxy egress sécurisé.

## Captures du pilote

Quand `captureScreenshots` est activé, le worker conserve au plus une capture
JPEG du viewport de la page principale par scan, avec une limite de 2 MiB. Les
octets restent hors PostgreSQL sous `SCAN_ARTIFACTS_DIR` (par défaut
`storage/scan-artifacts`) ; la base ne contient que la clé, le type, la taille
et le SHA-256.

Les audits publics terminés suivent une rétention automatique de 90 jours par
défaut, configurable avec `PUBLIC_AUDIT_RETENTION_DAYS`. La purge est exécutée
par le worker en lots bornés : elle supprime d'abord les fichiers d'artefacts,
puis le scan et ses données liées par cascade. Une erreur de suppression fichier
fait échouer la purge de ce scan plutôt que de laisser volontairement un fichier
orphelin. Un audit possédant encore un lien de rapport actif n'est pas purgé.

Les scans de monitoring vérifié ne sont pas concernés par cette politique. Les
paramètres `PUBLIC_AUDIT_RETENTION_BATCH_SIZE` et
`PUBLIC_AUDIT_RETENTION_INTERVAL_SECONDS` bornent respectivement la taille d'un
lot et la fréquence du coordinator.

## Rapports partageables

Les owners et admins peuvent créer un lien public temporaire pour un scan terminé
ou mettre un rapport en file d'envoi par e-mail. Le branding du pilote comprend
un nom de marque et une couleur d'accent ; aucun logo distant n'est chargé.

Les liens expirent après sept jours et peuvent être révoqués à tout moment. Le
jeton brut n'est pas stocké : PostgreSQL conserve son SHA-256 pour la résolution
publique et une copie chiffrée AES-256-GCM pour reconstruire le lien dans le
dashboard et l'outbox. `REPORT_TOKEN_SECRET` doit contenir au moins 32 caractères
aléatoires ; `REPORT_PUBLIC_BASE_URL` définit l'origine des liens envoyés.

Le rapport public est résolu uniquement par jeton, recroise organisation, site et
scan côté serveur, utilise `noindex/nofollow` et `no-referrer`, et ne nécessite
aucun identifiant interne dans son URL.

## Invariants de sécurité

- seules les URL HTTP(S) sur ports standards sont acceptées ;
- toutes les réponses DNS doivent être publiques ;
- chaque redirection devra être revalidée avant navigation ;
- les plages privées, locales, link-local, multicast et metadata cloud sont bloquées ;
- les workers Playwright seront isolés et limités en temps, pages et ressources ;
- chaque requête métier portera explicitement l'identifiant d'organisation ;
- aucun secret, mot de passe de site ou contenu sensible ne doit finir dans les logs ;
- les rapports partagés utilisent des jetons courts, révocables et expirants.

## Vérifications

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Voir `docs/adr/0001-pilot-scope-and-architecture.md` et `SECURITY.md`.
Le gate opérationnel avant toute mise en ligne est dans
`docs/operations/preproduction.md`.

Le fonctionnement du rapprochement CVE/KEV V3.1 est documenté dans
`docs/architecture/vulnerability-intelligence.md`.
