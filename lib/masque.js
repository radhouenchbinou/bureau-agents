// Masque les secrets qu'une consigne pourrait contenir (clé collée par erreur) avant qu'elle soit gardée ou servie.
// On garde le préfixe qui dit de quoi il s'agit, jamais la valeur.
'use strict';

const MOTIFS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[clé privée masquée]'],
  [/\b(sk-ant-[a-z0-9]{0,8}-)[A-Za-z0-9_-]{10,}/g, '$1••••'],
  [/\b(sk-(?:proj-)?)[A-Za-z0-9_-]{16,}/g, '$1••••'],
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g, '$1••••'],
  [/\b(ntn_|secret_)[A-Za-z0-9]{20,}/g, '$1••••'],
  [/\b(xox[abposr]-)[A-Za-z0-9-]{10,}/g, '$1••••'],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, '$1••••'],
  [/\b(AIza)[A-Za-z0-9_-]{30,}/g, '$1••••'],
  [/\b(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'eyJ••••'],
  [/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1••••@'],
  [/\b((?:pass(?:word|wd)?|pwd|mot de passe|token|jeton|secret|api[_-]?key|cl[ée] d'?api)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1••••']
];

const masquer = s => typeof s === 'string' ? MOTIFS.reduce((t, [re, rempl]) => t.replace(re, rempl), s) : s;

module.exports = { masquer };
