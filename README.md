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

Le coût est calculé avec les **prix publics de l'API Claude relevés le 2026-11-09** sur
<https://platform.claude.com/docs/en/about-claude/pricing> (date affichée dans l'onglet Rendement), en dollars par
million de jetons, **par version de modèle** : Opus 5.5 (4 / 20), Opus 4.5 à 4.8 (5 / 25), Opus 4 et 4.1 (15 / 75),
Sonnet 5.5 (2 / 10), Sonnet 4 à 4.6 (3 / 15), Haiku 5.5 (0,10 / 0,50, et 0,50 / 2,50 au-delà de 100 000 jetons de
prompt), Haiku 4.5 (1 / 5), Fable et Mythos (10 / 50)… Une version inconnue prend le prix de sa famille, un modèle
inconnu le tarif par défaut : le coût est alors marqué « ≈ » et le nombre de lignes concernées est indiqué.

Une session qui mêle plusieurs modèles (lead Opus, agents Haiku) est comptée **modèle par modèle**. Le cache lu suit le
prix de lecture propre au modèle (10 % de l'entrée en général, 5 % pour les 5.5) ; l'écriture en cache compte pour
125 % de l'entrée (5 min) ou 200 % (1 h), d'après le détail que donne Claude Code. Pour Codex, sans détail par modèle,
tout est compté au modèle principal.

C'est une estimation : un abonnement ne coûte pas ce montant. Pour changer ou compléter la grille, ajouter une clé
`prix` dans `~/.bureau-agents/organisation.json` (champs `entree`, `sortie`, et facultatifs `lu`, `e5`, `e1`) :

```json
"prix": { "opus-5-5": { "entree": 4, "sortie": 20, "lu": 0.2 }, "gpt": { "entree": 2.5, "sortie": 10 } }
```

Les **commits** comptés sont ceux d'une commande qui commence par `git commit` (hors `--amend`, `--dry-run` et texte
entre guillemets) et dont le résultat est revenu sans erreur.

### Projets créés automatiquement

Chaque nouveau dépôt crée un projet et son bureau. S'il n'est jamais retouché (renommé, déplacé, fusionné, tech lead,
session rattachée) et n'apparaît plus pendant 30 jours, il est retiré avec son bureau. Ce qui a été retouché reste.

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
| `BUREAU_TOKEN` | vide | jeton d'accès ; ouvrir une fois `http://<poste>:4747/?t=<jeton>` : un cookie de session prend le relais |
| `BUREAU_HOSTS` | vide | noms d'hôte acceptés en plus, avec le port (`bureau.lan:4747,…`) |
| `BUREAU_HTTPS` | vide | `1` derrière un proxy HTTPS : cookie `Secure` |
| `BUREAU_CLAUDE_DIR` | `~/.claude` | dossier de Claude Code |
| `BUREAU_CODEX_DIR` | `~/.codex` | dossier de Codex |
| `BUREAU_DATA` | `~/.bureau-agents` | dossier des données du bureau |
| `BUREAU_HORIZON_JOURS` | `7` | ancienneté maximale des sessions fermées lues |

## Sécurité

- Le serveur n'écoute que sur le poste par défaut, et n'accepte alors que les noms `127.0.0.1`, `localhost` et `[::1]`
  sur son port (en-tête `Host`, réponse 421 sinon) : une page qui ferait pointer son propre domaine sur 127.0.0.1
  (« DNS rebinding ») ne peut ni lire l'état ni récupérer le jeton de page.
- Ouvert au réseau, il exige `BUREAU_TOKEN`. Le lien `?t=<jeton>` pose un cookie `HttpOnly; SameSite=Strict` (dérivé
  du jeton, jamais le jeton lui-même) puis recharge la page sans le jeton : il ne reste ni dans l'historique ni dans les
  journaux. Les scripts peuvent envoyer l'en-tête `X-Bureau-Token`.
- Les modifications (`POST /api/organisation`) doivent venir de la même origine, au format JSON, avec un jeton de page
  généré à chaque démarrage. Un autre site ouvert dans le navigateur ne peut donc pas changer l'organisation.
- Aucun contenu de conversation n'est servi, seulement des descriptions, des compteurs et les 300 premiers caractères de
  la consigne d'un agent, **secrets masqués** (clés d'API, jetons GitHub / Notion / Slack / AWS / Google, JWT, clés
  privées, mots de passe dans une URL ou après `password=`, `token:`…).
- Politique de contenu stricte : scripts du serveur seulement (`script-src 'self'`), ni `<base>`, ni objets, ni cadres.
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
lib/kpi.js             indicateurs agrégés et coût estimé (grille datée, coût par modèle)
lib/acces.js           nom d'hôte attendu, jeton et cookie de session
lib/masque.js          masquage des secrets dans les consignes
public/bureau.js       scène 2.5D en Canvas 2D
public/                reste du front (HTML, CSS, JS sans framework)
test/                  tests node:test
```

Pour ajouter un outil avec historique lisible, écrire une source qui renvoie `{ sessions, agents }` au même format que
`lib/source-claude.js`. Pour un outil vu par ses processus, ajouter une ligne à `OUTILS` dans `lib/source-processus.js`.
