// Lance le bon installateur selon le système : installer.sh (macOS, Linux) ou installer.ps1 (Windows)
'use strict';
const { spawnSync } = require('child_process'), path = require('path');
const racine = path.join(__dirname, '..'), retirer = process.argv.includes('--retirer');
const r = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(racine, 'installer.ps1'), ...(retirer ? ['-Retirer'] : [])], { stdio: 'inherit' })
  : spawnSync('sh', [path.join(racine, 'installer.sh'), ...(retirer ? ['--retirer'] : [])], { stdio: 'inherit' });
process.exit(r.status ?? 1);
