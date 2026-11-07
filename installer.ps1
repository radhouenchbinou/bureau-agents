# Démarrage automatique du bureau des agents sous Windows : tâche planifiée à l'ouverture de session de l'utilisateur.
# Usage : powershell -ExecutionPolicy Bypass -File installer.ps1 [-Retirer]
param([switch]$Retirer)
$ErrorActionPreference = 'Stop'
$Nom = 'Bureau des agents'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Logs = Join-Path $env:USERPROFILE '.bureau-agents'

if ($Retirer) {
  Stop-ScheduledTask -TaskName $Nom -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Nom -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Démarrage automatique retiré.'
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error 'node introuvable dans le PATH'; exit 1 }
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

# cmd /c pour rediriger la sortie vers le journal ; fenêtre masquée
$Arg = '/c ""' + $Node + '" "' + (Join-Path $Dir 'server.js') + '" >> "' + (Join-Path $Logs 'serveur.log') + '" 2>&1"'
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $Arg -WorkingDirectory $Dir
$Declencheur = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Reglages = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
Unregister-ScheduledTask -TaskName $Nom -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $Nom -Action $Action -Trigger $Declencheur -Settings $Reglages -Description 'Serveur local du bureau des agents' | Out-Null
Start-ScheduledTask -TaskName $Nom
$Port = if ($env:BUREAU_PORT) { $env:BUREAU_PORT } else { 4747 }
Write-Host "Bureau des agents démarré : http://localhost:$Port/ (journal : $Logs\serveur.log)"
