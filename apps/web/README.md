# Application Web WebProbe

`apps/web` contient l'interface Web et les routes serveur de WebProbe.

## Technologies

L'application utilise Next.js, React et TypeScript dans le monorepo pnpm.

## Responsabilités

Elle gère notamment :

- authentification et sessions ;
- organisations et sites ;
- vérification de propriété ;
- création des scans ;
- consultation de l'historique et des rapports ;
- gestion des grants Deep ;
- rapports partageables ;
- endpoints de santé et de disponibilité.

L'exécution des scans elle-même est déléguée à `apps/worker`.

## Développement

Depuis la racine du dépôt :

```bash
pnpm install
pnpm infra:up
pnpm dev
```

L'application locale est accessible par défaut sur `http://localhost:3000`.

Pour lancer uniquement l'application Web :

```bash
pnpm --filter web dev
```

## Construction

```bash
pnpm --filter web build
```

La construction globale du monorepo reste disponible avec `pnpm build`.

## Configuration

Les variables importantes comprennent notamment `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, les variables SMTP, `SCAN_ARTIFACTS_DIR`, `REPORT_PUBLIC_BASE_URL` et `REPORT_TOKEN_SECRET`.

Utiliser le fichier `.env.example` de la racine comme référence. Aucun secret réel ne doit être versionné.

## Documentation

Voir le `README.md` racine, `SECURITY.md` et `docs/operations/production.md`.
