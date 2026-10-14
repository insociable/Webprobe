# Exception temporaire de sécurité — braces / GHSA-vfj7-8cjw-p6xm

**Décision :** risque explicitement accepté à titre provisoire par le propriétaire de WebProbe le 14 octobre 2026. **Expiration stricte : 14 novembre 2026.** L'exception ne constitue pas un correctif.

## Qualification

- Alerte haute GHSA-vfj7-8cjw-p6xm (CVE-2026-93687, déni de service par récursion profonde).
- Paquet npm braces@3.0.3, dernière version affectée dans l'avis au 14 octobre 2026. **Aucune version corrigée publiée** à cette date.
- Chemin confirmé : web (devDependency) > eslint-config-next@16.3.8 > @next/eslint-plugin-next@16.3.8 > fast-glob@3.3.1 > micromatch@4.0.8 > braces@3.0.3.
- Les six graphes de dépendances de production ne contiennent pas braces (vérification dynamique avec pnpm -r list --prod --json --depth 30). Audit pnpm --prod --audit-level high sans alerte au moment de la décision.
- Le risque résiduel est limité aux traitements de motifs de lint depuis un environnement de développement / CI, mais n'est pas nul pour ce code. Ne pas exposer ce traitement à des motifs non fiables.

Sources publiques :

- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/micromatch/braces/issues/84
- Suivi WebProbe : https://github.com/insociable/Webprobe/issues/99

## Mesures compensatoires contrôlables

1. Une seule exception est autorisée, son identifiant exact GHSA-vfj7-8cjw-p6xm ; OSV continue de bloquer toute autre vulnérabilité.
2. L'exception expire automatiquement le 14 novembre 2026 à 23:59:59 UTC. Le script échoue après cette date ou si la durée est augmentée sans nouvelle revue.
3. Le job GitHub Verify accepted dev-only advisory, exécuté sur les PR, push et calendrier, compare les graphes pnpm complets et production :
   - aucun chemin runtime vers braces ;
   - un seul chemin de développement exact et sa version 3.0.3 ;
   - exactement six workspaces ;
   - une seule exception et une justification non vide.
4. Le contrôle produit explicitement un warning et un résumé GitHub : le résultat vert signifie « contrôle satisfait avec risque accepté », **pas** « vulnérabilité résolue ».
5. Le scan OSV complet reste actif sur main et les exécutions planifiées. Les alertes GitHub Dependabot / Security ne doivent pas être dissimulées ou déclarées fermées sans résolution effective.

## Sortie de l'exception

Au plus tard avant le 14 novembre 2026 : vérifier si une version officielle corrigée existe ; sinon examiner une alternative vérifiable à la chaîne ESLint Next, un correctif maintenu et audité, ou solliciter une nouvelle décision documentée du propriétaire. Exécuter tous les tests de lint, typage, intégration, sécurité et build. Supprimer l'exception et le script d'acceptation lorsque braces n'est plus présent ; constater OSV vert sans exception.

L'application déployée en production sur le SHA d756e71 n'est pas modifiée par ce lot de politique CI. Aucune suppression de contrôles de sécurité n'est autorisée.
