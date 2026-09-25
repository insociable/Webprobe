# Services systemd WebProbe

Les unités versionnées décrivent les services Web et Worker de l'instance actuelle.

## Fichiers

- `agency-saas-web.service` : application Next.js ;
- `agency-saas-worker.service` : worker de scans.

Les noms historiques `agency-saas-*` restent utilisés par l'infrastructure afin d'éviter un renommage opérationnel inutile.

## Installation ou mise à jour

Depuis la VM :

```bash
install -o root -g root -m 0644 /srv/agency-saas/infra/systemd/agency-saas-web.service /etc/systemd/system/agency-saas-web.service
install -o root -g root -m 0644 /srv/agency-saas/infra/systemd/agency-saas-worker.service /etc/systemd/system/agency-saas-worker.service
systemctl daemon-reload
systemctl enable agency-saas-web.service agency-saas-worker.service
```

Ne pas remplacer une unité de production sans comparer d'abord la version installée et la version du dépôt.

## Construction et redémarrage

Construire le code avant de redémarrer un service :

```bash
cd /srv/agency-saas
pnpm build
systemctl restart agency-saas-web.service
systemctl restart agency-saas-worker.service
systemctl is-active agency-saas-web.service
systemctl is-active agency-saas-worker.service
```

Redémarrer uniquement les services concernés lorsque cela est possible.

## Secrets

Les unités ne contiennent aucun secret applicatif.

La configuration sensible reste dans `/srv/agency-saas/.env`, non versionné et avec des permissions restrictives.
