# ADR 0001 — Périmètre pilote et architecture

- Statut : accepté
- Date : 2026-09-21

## Contexte

La proposition complète couvre surveillance, accessibilité, performance,
rapports, marque blanche, collaboration et facturation. Réaliser l'ensemble avant
validation commerciale créerait une V1 longue à tester et difficile à vendre.

Le risque technique dominant est l'exécution d'un navigateur sur une URL fournie
par un client. Le risque produit dominant est de construire un tableau de bord
riche sans preuve qu'une agence paiera pour le rapport récurrent.

## Décision

Construire d'abord une tranche verticale utilisable par cinq agences pilotes et
une vingtaine de sites :

- organisation et site vérifié ;
- scan manuel et hebdomadaire ;
- HTTP, TLS, en-têtes, liens, erreurs JavaScript et axe-core ;
- capture, historique et différences simples ;
- rapport partageable de marque et notification e-mail.

Le code forme un monolithe modulaire TypeScript avec une application Next.js.
Le traitement de scan utilise une file et un worker séparé. PostgreSQL reste la
source de vérité ; Valkey sert uniquement aux tâches et verrous éphémères.

Le navigateur sera exécuté dans une frontière isolée. La validation applicative
des URL est nécessaire mais ne remplace pas le filtrage réseau sortant.

## Conséquences

Avantages :

- une seule base métier et un déploiement compréhensible ;
- parcours client testable rapidement ;
- séparation du composant le plus risqué et coûteux ;
- extraction future possible sans contrat distribué prématuré.

Coûts :

- le worker et l'application doivent partager des contrats versionnés ;
- l'isolation réseau demande un travail dédié avant tout scan public ;
- certaines fonctions commerciales sont repoussées.

## Reporté

Invitations avancées, Stripe récurrent, crawl massif, Lighthouse complet,
intégrations, formulaires, applications mobiles, IA générative et multi-région
seront réévalués après les premiers usages payants.
