// Source « Claude Code » : sessions ouvertes ou récentes et leurs agents, lus dans le dossier ~/.claude (lecture seule)
'use strict';
const fsp = require('fs').promises, path = require('path'), os = require('os');
const { resume } = require('./transcript');

const AGENT_ACTIF_MS = 15 * 60e3;   // un agent non terminé sans écriture depuis 15 min est « en attente »
const SEP = /[\\/]/;

const vivant = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const lireJson = async f => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return null; } };
const stat = async f => { try { return await fsp.stat(f); } catch { return null; } };
const liste = async d => { try { return await fsp.readdir(d); } catch { return []; } };

// Nom de dépôt à partir du dossier de travail : la racine pour un worktree .claude/worktrees ou ~/…/wt/<nom>
function projetDuDossier(cwd) {
  if (!cwd) return '';
  const p = cwd.split(SEP).filter(Boolean), i = p.lastIndexOf('.claude');
  if (p.includes('scratch-workspaces')) return 'brouillons';
  if (i > 0 && p[i + 1] === 'worktrees') return p[i - 1];
  return p[p.length - 1] || '';
}
// Repli quand la session n'a pas de cwd connu : le dossier projet encode le chemin (chaque caractère non alphanumérique → « - »)
function projetDuDossierEncode(nom, home) {
  const pre = home.replace(/[^a-zA-Z0-9]/g, '-') + '-';
  return nom.replace(pre, '').replace(/^IdeaProjects-/, '').split('--')[0] || nom;
}

class SourceClaude {
  constructor({ dossier = path.join(os.homedir(), '.claude'), horizonMs = 7 * 864e5, index }) {
    this.dossier = dossier; this.horizonMs = horizonMs; this.index = index; this.home = os.homedir();
    this.progression = { faits: 0, total: 0 };
  }

  // Renvoie { sessions, agents } ; chaque appel ne relit que ce qui a changé
  async scanner(maintenant = Date.now()) {
    const ouvertes = new Map();
    for (const f of (await liste(path.join(this.dossier, 'sessions'))).filter(f => f.endsWith('.json'))) {
      const s = await lireJson(path.join(this.dossier, 'sessions', f));
      if (s && s.sessionId && vivant(s.pid)) ouvertes.set(s.sessionId, s);
    }
    const projets = path.join(this.dossier, 'projects'), cibles = [];
    for (const d of await liste(projets)) {
      const dir = path.join(projets, d);
      for (const e of (await liste(dir)).filter(e => e.endsWith('.jsonl'))) {
        const id = e.slice(0, -6), f = path.join(dir, e), st = await stat(f); if (!st) continue;
        const live = ouvertes.get(id);
        if (!live && maintenant - st.mtimeMs > this.horizonMs) continue;
        cibles.push({ id, dir, f, st, live });
      }
    }
    this.progression = { faits: 0, total: cibles.length };
    const sessions = [], agents = [], vus = new Set();
    for (const c of cibles) {
      const stats = await this.index.lire(c.f, c.st.size); vus.add(c.f);
      const sdir = path.join(c.dir, c.id), live = c.live;
      const titre = (await lireJson(path.join(sdir, 'custom-title.json')) || {}).customTitle;
      const cwd = (live && live.cwd) || stats.cwd || '';
      const s = {
        cle: 's:' + c.id, id: c.id, source: 'claude-code', niveau: 'complet',
        nomOrigine: (live && live.name) || titre || (stats.consigne && stats.consigne.slice(0, 60)) || c.id.slice(0, 8),
        cwd, depot: cwd ? projetDuDossier(cwd) : projetDuDossierEncode(path.basename(c.dir), this.home),
        etat: live ? (live.status === 'busy' ? 'active' : 'inactive') : 'terminee', pid: live ? live.pid : null,
        debut: stats.debut || c.st.birthtimeMs, derniereActivite: Math.max(c.st.mtimeMs, (live && live.statusUpdatedAt) || 0),
        stats: resume(stats), agents: []
      };
      for (const f of (await liste(path.join(sdir, 'subagents'))).filter(f => f.endsWith('.meta.json'))) {
        const aid = f.slice(0, -10), meta = await lireJson(path.join(sdir, 'subagents', f)); if (!meta) continue;
        const jf = path.join(sdir, 'subagents', aid + '.jsonl'), ast = await stat(jf), mt = ast ? ast.mtimeMs : 0;
        if (maintenant - mt > this.horizonMs && meta.finished) continue;
        const as = ast ? await this.index.lire(jf, ast.size) : null; if (ast) vus.add(jf);
        const etat = meta.finished ? 'termine' : !live ? 'interrompu' : maintenant - mt < AGENT_ACTIF_MS ? 'en_cours' : 'en_attente';
        const a = {
          cle: 'a:' + c.id + ':' + aid, id: aid, session: s.cle, source: 'claude-code', niveau: 'complet',
          nomOrigine: meta.description || aid, type: meta.agentType || 'agent', etat, arrierePlan: meta.requestShape === 'background',
          debut: (as && as.debut) || mt, derniereActivite: mt, consigne: as ? as.consigne : '',
          worktree: ((as && as.consigne || '').match(/[\\/](?:wt|\.claude[\\/]worktrees)[\\/]([\w.-]+)/) || [])[1] || '',
          stats: as ? resume(as) : null
        };
        s.agents.push(a.cle); agents.push(a);
      }
      sessions.push(s);
      this.progression.faits++;
    }
    return { sessions, agents, vus: [...vus] };
  }
}

module.exports = { SourceClaude, projetDuDossier, projetDuDossierEncode };
