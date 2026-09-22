# Development worker service

The development VM runs the scanner worker as a systemd service.

The unit:

- runs as the unprivileged `vboxuser` account;
- reads runtime configuration from `/srv/agency-saas/.env`;
- starts the already-built worker from `apps/worker/dist/index.js`;
- restarts automatically after an unexpected exit;
- enables basic systemd sandboxing.

## Install or refresh the unit

```sh
install -o root -g root -m 0644   /srv/agency-saas/infra/systemd/agency-saas-worker.service   /etc/systemd/system/agency-saas-worker.service
systemctl daemon-reload
systemctl enable --now agency-saas-worker.service
```

## Deploy new worker code on the development VM

Build the worker and its workspace dependencies first:

```sh
cd /srv/agency-saas
runuser -u vboxuser -- env HOME=/home/vboxuser   XDG_CONFIG_HOME=/home/vboxuser/.config   pnpm exec turbo build --filter=@agency-saas/worker
systemctl restart agency-saas-worker.service
systemctl is-active agency-saas-worker.service
```

Do not place secrets in the unit file. Keep them in the ignored `.env` file with restrictive permissions.
