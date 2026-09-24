# ADR 0001 — Architecture initiale de WebProbe

- Statut : accepté
- Date : 2026-09-21

## Contexte

WebProbe doit exécuter des analyses de sites publics tout en isolant le composant navigateur, en gardant une architecture exploitable sur une seule infrastructure et en évitant de distribuer inutilement les responsabilités.

Le risque technique principal est l'exécution de Chromium et l'accès réseau à partir d'URL fournies à l'application.

## Décision

Le projet utilise un monolithe modulaire TypeScript avec :

- une application Next.js ;
- un worker de scan séparé ;
- PostgreSQL comme source de vérité ;
- Valkey et BullMQ pour les tâches et états éphémères ;
- des contrats partagés ;
- un composant de sécurité réseau commun.

Le navigateur est traité comme une frontière de sécurité et de ressources distincte du serveur Web.

## Conséquences

Cette architecture permet :

- une base métier unique ;
- un déploiement compréhensible ;
- une séparation claire du navigateur ;
- des contrôles de sécurité partagés ;
- une évolution incrémentale sans imposer de microservices.

Elle implique en contrepartie :

- des contrats versionnés entre Web et Worker ;
- une attention particulière au réseau sortant ;
- une cohérence stricte entre migrations et version applicative ;
- une supervision séparée des deux services.

## Évolution

L'architecture a depuis été étendue avec l'Audit public, le monitoring vérifié, les rapports partageables et le moteur d'Audit approfondi V3.

Les détails actuels du moteur Deep se trouvent dans `docs/architecture/v3-scan-engine.md`. Ce document conserve la décision structurante initiale sans prétendre décrire à lui seul l'état fonctionnel complet du projet.
