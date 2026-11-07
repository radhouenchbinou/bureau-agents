# Bureau des agents

Serveur local qui repère les agents de codage du poste (Claude Code pour l'instant) et les range dans un plan de bureaux
en 2D. On y organise les équipes, on suit le rendement des agents et la santé du poste. Fonctionne sous macOS, Linux et
Windows. Les données se rafraîchissent toutes les 10 secondes.

## Lancer

Node 18.15 ou plus, aucune dépendance npm.

```bash
npm start            # au premier plan, http://localhost:4747/
npm run installer    # démarrage automatique à l'ouverture de session
npm run retirer      # retire le démarrage automatique
npm test             # tests unitaires
```

`npm run installer` choisit le mécanisme selon le système :

| Système | Mécanisme | Journal |
|---|---|---|
| macOS | LaunchAgent `com.bureau-agents.serveur` | `~/.bureau-agents/serveur.log` |
| Linux | service systemd utilisateur `bureau-agents` | `~/.bureau-agents/serveur.log` |
| Windows | tâche planifiée « Bureau des agents » à l'ouverture de session | `%USERPROFILE%\.bureau-agents\serveur.log` |

## Les vues

- **Plan** : un bureau par projet au départ. Chaque session Claude Code est un lead, avec ses agents à côté.
  - On glisse une personne ou une session vers un autre bureau. Sur téléphone, on passe par la fiche.
  - La fiche permet de renommer, de changer de projet et de donner un rôle.
- **Rendement** : indicateurs sur 1 h, 24 h ou 7 jours, au global, par projet, par bureau, par agent et par session. Les tableaux se trient.
- **Poste** : processeur, charge, swap ou fichier d'échange, mémoire, disque, builds en parallèle, batterie et température.
  - Courbes sur 24 h, avec un verdict et des actions conseillées.
  - Un indicateur que le système ne fournit pas s'affiche « non disponible ».
- **Organisation** :
  - rôles globaux : chef de projet et tech lead ;
  - projets : renommer, tech lead du projet, bureau par défaut, fusion de plusieurs dépôts en un projet ;
  - bureaux ;
  - noms donnés aux agents.

## Ce qui est lu (lecture seule)

| Donnée | Source |
|---|---|
| Sessions ouvertes (nom, dossier, active ou en pause) | `~/.claude/sessions/*.json`, processus encore vivants |
| Sessions récentes (7 jours par défaut) | transcripts `~/.claude/projects/*/<session>.jsonl` |
| Agents d'une session | `~/.claude/projects/*/<session>/subagents/*.meta.json` et `.jsonl` |
| Rendement | lu dans les transcripts : temps actif, appels d'outils et erreurs, éditions et fichiers, commits, jetons, modèle |
| Poste | module `os` de Node et `fs.statfs`, plus des compléments propres à chaque système (voir ci-dessous) |

Compléments propres à chaque système :

- **macOS** : `sysctl`, `memory_pressure`, `pmset`, `ps` et `lsof`.
- **Linux** : `/proc` et `/sys`.
- **Windows** : un appel PowerShell (`Get-CimInstance`, `Get-Process`) par relevé.

Les transcripts sont lus **de façon incrémentale** : seuls les octets ajoutés depuis le dernier passage sont relus. La
position atteinte dans chaque fichier et les compteurs sont gardés dans `~/.bureau-agents/index-transcripts.json`, ce qui
rend les redémarrages rapides.

État d'un agent :

- **terminé** : son fichier `meta.json` porte `finished` ;
- **en cours** : il n'est pas terminé et a écrit dans les 15 dernières minutes ;
- **en attente** : il n'est pas terminé et n'a rien écrit depuis 15 minutes ;
- **interrompu** : sa session est fermée avant qu'il ait fini.

### Coût estimé

Le coût est calculé avec des **prix publics d'API**, en dollars par million de jetons, selon la famille du modèle. C'est
une estimation : un abonnement ne coûte pas ce montant. Pour changer la grille, ajouter une clé `prix` dans
`~/.bureau-agents/organisation.json` :

```json
"prix": { "opus": { "entree": 15, "sortie": 75 }, "sonnet": { "entree": 3, "sortie": 15 } }
```

Le cache lu compte pour 10 % du prix d'entrée, l'écriture en cache pour 125 %.

## Ce qui est écrit

Rien en dehors de `~/.bureau-agents/` :

- `organisation.json` contient les bureaux, les projets, les rôles, les placements, les noms donnés et la grille de prix ;
- `historique.json` garde les relevés du poste sur 24 h ;
- `index-transcripts.json` contient l'index de lecture des transcripts.

Les fichiers de Claude Code ne sont jamais modifiés.

## Réglages

| Variable | Défaut | Rôle |
|---|---|---|
| `BUREAU_PORT` | `4747` | port d'écoute |
| `BUREAU_HOST` | `127.0.0.1` | `0.0.0.0` pour ouvrir au réseau local, exige `BUREAU_TOKEN` |
| `BUREAU_TOKEN` | vide | jeton à passer dans l'URL : `http://<poste>:4747/?t=<jeton>` |
| `BUREAU_CLAUDE_DIR` | `~/.claude` | dossier de Claude Code |
| `BUREAU_DATA` | `~/.bureau-agents` | dossier des données du bureau |
| `BUREAU_HORIZON_JOURS` | `7` | ancienneté maximale des sessions fermées lues |

## Sécurité

- Le serveur n'écoute que sur le poste par défaut.
- Les modifications (`POST /api/organisation`) doivent venir de la même origine, au format JSON, avec un jeton de page
  généré à chaque démarrage. Un autre site ouvert dans le navigateur ne peut donc pas changer l'organisation.
- Aucun contenu de conversation n'est servi, seulement des descriptions, des compteurs et les 300 premiers caractères de
  la consigne d'un agent.
- Les noms saisis sont nettoyés (60 caractères au plus) et affichés comme du texte.

## Structure

```
server.js              routes HTTP, collecte toutes les 10 s, sauvegarde toutes les 30 s
lib/transcript.js      index incrémental des transcripts et compteurs de rendement
lib/source-claude.js   sessions et agents Claude Code
lib/poste.js           santé du poste : macOS, Linux, Windows
lib/organisation.js    bureaux, projets, rôles, placements et noms
lib/kpi.js             indicateurs agrégés et coût estimé
public/                front (HTML, CSS, JS sans framework)
test/                  tests node:test
```

Pour ajouter un autre outil d'agents, écrire une source qui renvoie `{ sessions, agents }` au même format que
`lib/source-claude.js`.
