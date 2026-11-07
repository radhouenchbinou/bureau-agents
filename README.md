# Bureau des agents

Petit serveur local qui montre, dans un bureau en 3D, toutes les sessions Claude Code ouvertes sur ce Mac et les
agents qu'elles ont lancés. Il affiche aussi la santé du Mac. Les données se rafraîchissent toutes les 10 secondes,
sans intervention.

## Lancer

```bash
npm start            # au premier plan, http://localhost:4747/
npm run installer    # démarrage automatique à l'ouverture de session (LaunchAgent)
npm run retirer      # retire le démarrage automatique
```

Aucune dépendance npm : Node 18 ou plus suffit. Three.js r128 est copié dans `public/vendor/`.

## Ce qui est lu (lecture seule)

| Donnée | Source |
|---|---|
| Sessions ouvertes (nom, dossier, active ou inactive) | `~/.claude/sessions/*.json`, processus encore vivants |
| Sessions terminées des dernières 24 h | transcripts `~/.claude/projects/*/<session>.jsonl` modifiés depuis 24 h |
| Agents d'une session (description, type, terminé) | `~/.claude/projects/*/<session>/subagents/*.meta.json` |
| Consigne et dernière activité d'un agent | 300 premiers caractères et date du `agent-*.jsonl` |
| Santé du Mac | `sysctl`, `memory_pressure`, `df`, `pmset`, `ps`, `lsof` (dossier des JVM pour repérer les builds) |

État d'un agent :

- **terminé** : le fichier `meta.json` porte `finished` ;
- **en cours** : il n'est pas terminé et son transcript a été écrit dans les 15 dernières minutes ;
- **en attente** : il n'est pas terminé, mais rien n'a été écrit depuis 15 minutes ;
- **interrompu** : il n'est pas terminé et sa session est fermée.

L'historique de charge et de swap (2 h, un point par minute) est gardé dans `~/.bureau-agents/historique.json`.

## Réglages

| Variable | Défaut | Rôle |
|---|---|---|
| `BUREAU_PORT` | `4747` | port d'écoute |
| `BUREAU_HOST` | `127.0.0.1` | `0.0.0.0` pour l'ouvrir au Wi-Fi local, exige `BUREAU_TOKEN` |
| `BUREAU_TOKEN` | vide | jeton à passer dans l'URL : `http://<mac>.local:4747/?t=<jeton>` |

Par défaut, le serveur n'écoute que sur le Mac. Aucun contenu de conversation n'est servi, seulement les descriptions
d'agents et le début de leur consigne.
