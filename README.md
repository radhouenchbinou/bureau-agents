# Bureau des agents

Serveur local qui repère les agents de codage et les modèles locaux d'un poste, et les montre dans un bureau en 2.5D
(vue isométrique). Ceux qui travaillent tapent à leur poste, les inactifs marchent jusqu'à la salle de pause, et les
modèles locaux occupent des baies dans la salle des modèles. On y organise les équipes, on suit le rendement et la santé
du poste. Fonctionne sous macOS, Linux et Windows. Les données se rafraîchissent toutes les 10 secondes.

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

- **Plan** : le bureau en 2.5D. Un bureau par projet, une salle de pause et une salle des modèles.
  - Déplacer la vue : glisser le fond. Zoomer : molette, pincement ou boutons.
  - Changer quelqu'un de bureau : le glisser. Au doigt, le maintenir appuyé d'abord, ou passer par sa fiche.
  - La fiche permet de renommer, de changer de projet et de donner un rôle.
  - Sous le plan, une liste donne les mêmes informations (clavier, lecteur d'écran, petits écrans) et la liste de ceux qui sont partis.
- **Rendement** : indicateurs sur 1 h, 24 h ou 7 jours, au global, par projet, par bureau, par agent et par session.
- **Poste** : processeur, GPU, charge, swap, mémoire, disque, builds, batterie, température, et la liste des modèles locaux.
- **Organisation** : seuil de la pause, rôles, projets, bureaux et noms donnés.

## Qui va où

| État | Où | Quand |
|---|---|---|
| Au travail | À son poste | Écriture depuis moins de 2 min (réglable), ou un outil tourne encore |
| Inactif | Salle de pause | Rien depuis ce délai, ou la session attend une réponse |
| Terminé ou interrompu | Quitte le bureau | Reste visible dans Rendement et dans la liste sous le plan |

Un changement n'est appliqué qu'après 30 s dans le nouvel état, pour éviter les allers-retours. Un outil sans résultat
depuis plus d'une heure est considéré comme perdu.

## Ce qui est détecté

| Niveau | Outils | Ce qu'on voit | Source (lecture seule) |
|---|---|---|---|
| **Complet** | Claude Code | Tâche, modèle, outils, jetons, état | `~/.claude/sessions`, `~/.claude/projects/*` |
| **Complet** | Codex | Idem | `~/.codex/sessions`, `session_index.jsonl` |
| **Présence** | GitHub Copilot, Cursor, Windsurf, Codeium, Aider, Gemini CLI, Goose, OpenCode, Qwen Code, Amp, Tabnine | Nom, dossier, processeur, mémoire. Ni tâche ni jetons | Liste des processus |
| **Modèles locaux** | Ollama, LM Studio, llama.cpp, MLX, vLLM, KoboldCpp, LocalAI, GPT4All, Jan | Modèles installés et chargés, mémoire, calcul en cours | API du moteur sur 127.0.0.1 |

Limites :

- Un outil de niveau présence passe « à son poste » quand ses processus utilisent le processeur. Il peut tourner sans agent actif, dès que son éditeur est ouvert.
- Un moteur local n'indique pas quel agent utilise un modèle : aucun lien n'est affiché. Quand plusieurs modèles sont chargés, ils sont tous marqués « calcule » dès qu'un processus de modèle travaille.
- Les fils Codex sans contexte de tour sont des sessions d'autres outils importées par Codex : ils sont ignorés.
- Les agents dans le cloud ou dans un conteneur ne sont pas visibles.
- Seuls Claude Code, Codex, Copilot et Ollama ont été testés sur de vraies données. Les autres outils reposent sur une signature de processus.

Le rendement vient des historiques (temps actif, appels d'outils et erreurs, éditions, commits, jetons). Le poste vient
du module `os` de Node et de `fs.statfs`, complétés par :

- **macOS** : `sysctl`, `memory_pressure`, `pmset`, `ps`, `lsof`, `ioreg` (GPU) ;
- **Linux** : `/proc`, `/sys`, `ps`, `nvidia-smi` s'il est présent ;
- **Windows** : un appel PowerShell (`Get-CimInstance`, `Get-Process`) par relevé, `nvidia-smi` s'il est présent.

Les historiques sont lus **de façon incrémentale** : seuls les octets ajoutés sont relus. La position atteinte et les
compteurs sont gardés dans `~/.bureau-agents/index-transcripts.json`, ce qui rend les redémarrages rapides.

### Coût estimé

Le coût est calculé avec des **prix publics d'API**, en dollars par million de jetons, selon la famille du modèle. C'est
une estimation : un abonnement ne coûte pas ce montant. Un modèle absent de la grille, comme ceux de Codex, utilise le
tarif par défaut. Pour changer la grille, ajouter une clé `prix` dans `~/.bureau-agents/organisation.json` :

```json
"prix": { "opus": { "entree": 15, "sortie": 75 }, "gpt": { "entree": 2.5, "sortie": 10 } }
```

Le cache lu compte pour 10 % du prix d'entrée, l'écriture en cache pour 125 %.

## Ce qui est écrit

Rien en dehors de `~/.bureau-agents/` :

- `organisation.json` contient les bureaux, les projets, les rôles, les placements, les noms donnés et la grille de prix ;
- `historique.json` garde les relevés du poste sur 24 h ;
- `index-transcripts.json` contient l'index de lecture des transcripts.

Les fichiers des outils ne sont jamais modifiés.

## Réglages

| Variable | Défaut | Rôle |
|---|---|---|
| `BUREAU_PORT` | `4747` | port d'écoute |
| `BUREAU_HOST` | `127.0.0.1` | `0.0.0.0` pour ouvrir au réseau local, exige `BUREAU_TOKEN` |
| `BUREAU_TOKEN` | vide | jeton à passer dans l'URL : `http://<poste>:4747/?t=<jeton>` |
| `BUREAU_CLAUDE_DIR` | `~/.claude` | dossier de Claude Code |
| `BUREAU_CODEX_DIR` | `~/.codex` | dossier de Codex |
| `BUREAU_DATA` | `~/.bureau-agents` | dossier des données du bureau |
| `BUREAU_HORIZON_JOURS` | `7` | ancienneté maximale des sessions fermées lues |

## Sécurité

- Le serveur n'écoute que sur le poste par défaut.
- Les modifications (`POST /api/organisation`) doivent venir de la même origine, au format JSON, avec un jeton de page
  généré à chaque démarrage. Un autre site ouvert dans le navigateur ne peut donc pas changer l'organisation.
- Aucun contenu de conversation n'est servi, seulement des descriptions, des compteurs et les 300 premiers caractères de
  la consigne d'un agent.
- Les fichiers d'identifiants (`auth.json`, `auth.db`, `oauth.json`, clés de `~/.ollama`) ne sont jamais lus.
- Les lignes de commande servent à reconnaître un outil et son port ; elles ne sont ni gardées ni renvoyées, car elles
  peuvent contenir des secrets.
- Seuls les ports des moteurs réellement lancés sont interrogés, uniquement sur 127.0.0.1.
- Les noms saisis sont nettoyés (60 caractères au plus) et affichés comme du texte.

## Structure

```
server.js              routes HTTP, collecte toutes les 10 s, sauvegarde toutes les 30 s
lib/transcript.js      index incrémental des transcripts et compteurs de rendement
lib/source-claude.js   sessions et agents Claude Code
lib/source-codex.js    fils et agents Codex
lib/source-processus.js outils vus par leurs processus et modèles locaux
lib/presence.js        à son poste, en pause ou parti
lib/poste.js           santé du poste : macOS, Linux, Windows
lib/organisation.js    bureaux, projets, rôles, placements et noms
lib/kpi.js             indicateurs agrégés et coût estimé
public/bureau.js       scène 2.5D en Canvas 2D
public/                reste du front (HTML, CSS, JS sans framework)
test/                  tests node:test
```

Pour ajouter un outil avec historique lisible, écrire une source qui renvoie `{ sessions, agents }` au même format que
`lib/source-claude.js`. Pour un outil vu par ses processus, ajouter une ligne à `OUTILS` dans `lib/source-processus.js`.
