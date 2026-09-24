# Audit public — modèle de sécurité

## Périmètre

`public_audit` est le mode d'audit ponctuel d'un site HTTP(S) public. Il est distinct du monitoring vérifié.

Les modes persistés sont notamment :

- `public_audit` : observation ponctuelle d'un site public ;
- `verified_monitoring` : monitoring d'un site actif dont la propriété a été vérifiée ;
- `verified_deep_audit` : Audit approfondi avec cycle de vie dédié.

Le mode persisté en PostgreSQL fait foi. Une charge utile issue du navigateur ou de BullMQ ne peut pas élever le mode du scan.

## Politique réseau et navigateur

L'Audit public est passif et borné :

- déclenchement manuel ;
- profil serveur limité ;
- méthodes HTTP compatibles avec une observation non destructive ;
- WebSockets bloqués ;
- téléchargements et service workers désactivés dans le parcours concerné ;
- Chromium forcé par le proxy sûr ;
- destinations privées, loopback, link-local et non publiques refusées ;
- redirections revalidées ;
- changement d'origine d'exploration non accordé automatiquement.

## Exploration et robots.txt

L'Audit public respecte `robots.txt` pour l'exploration.

Les URL interdites par la politique robots sont enregistrées dans la couverture mais ne sont pas visitées. Si la politique ne peut pas être récupérée de façon sûre, l'exploration profonde s'arrête plutôt que de supposer une autorisation.

La couverture doit alors être présentée comme partielle.

## Quotas

L'Audit public est exclu du planificateur de monitoring.

Les quotas serveur comprennent notamment :

- demandes par utilisateur et par heure ;
- concurrence par utilisateur ;
- cooldown par hostname.

Ils sont configurables avec les variables `PUBLIC_AUDIT_*` documentées dans `.env.example`.

## Rapports et notifications

Un Audit public sur un site non vérifié reste privé dans l'application.

Il ne participe pas aux notifications de dégradation/récupération du monitoring. Les baselines de monitoring vérifié sont sélectionnées parmi les scans `verified_monitoring`, afin qu'un ancien Audit public ne crée pas de faux changement de référence.

## Passage au monitoring vérifié

La vérification DNS du site fait évoluer son état sans réécrire l'historique.

Les anciens scans conservent leur `scan_mode`. Les futurs scans de monitoring utilisent `verified_monitoring` et exigent que le site reste actif et vérifié.

## Refus par défaut

L'Audit public doit être refusé ou annulé lorsqu'une couche ne peut plus confirmer le mode, le périmètre, l'état du site, la cible, les contraintes réseau ou la politique navigateur.

Il ne doit jamais être promu silencieusement vers un mode plus permissif.
