#!/bin/sh
# Démarrage automatique du bureau des agents à l'ouverture de session : LaunchAgent sous macOS, service systemd utilisateur sous Linux.
# Usage : sh installer.sh [--retirer]
set -eu
DIR=$(cd "$(dirname "$0")" && pwd)
LOGS="$HOME/.bureau-agents"
NOM=bureau-agents

retirer=0; [ "${1:-}" = "--retirer" ] && retirer=1

case "$(uname -s)" in
Darwin)
  LABEL=com.bureau-agents.serveur
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  # Ancien nom du service, retiré au passage
  launchctl bootout "gui/$(id -u)/com.radhouan.bureau-agents" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.radhouan.bureau-agents.plist"
  if [ $retirer = 1 ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "Démarrage automatique retiré."; exit 0
  fi
  NODE=$(command -v node) || { echo "node introuvable dans le PATH"; exit 1; }
  mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/serveur.log</string>
  <key>StandardErrorPath</key><string>$LOGS/serveur.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  ;;
Linux)
  UNIT="$HOME/.config/systemd/user/$NOM.service"
  command -v systemctl >/dev/null || { echo "systemd introuvable : lancer « npm start » à la main"; exit 1; }
  if [ $retirer = 1 ]; then
    systemctl --user disable --now $NOM 2>/dev/null || true; rm -f "$UNIT"; systemctl --user daemon-reload; echo "Démarrage automatique retiré."; exit 0
  fi
  NODE=$(command -v node) || { echo "node introuvable dans le PATH"; exit 1; }
  mkdir -p "$LOGS" "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=Bureau des agents
After=default.target

[Service]
ExecStart=$NODE $DIR/server.js
WorkingDirectory=$DIR
Restart=on-failure
RestartSec=5
StandardOutput=append:$LOGS/serveur.log
StandardError=append:$LOGS/serveur.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now $NOM
  ;;
*) echo "Système non pris en charge par ce script ; sous Windows, utiliser installer.ps1"; exit 1 ;;
esac
echo "Bureau des agents démarré : http://localhost:${BUREAU_PORT:-4747}/ (journal : $LOGS/serveur.log)"
