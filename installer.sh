#!/bin/zsh
# Installe (ou désinstalle avec --retirer) le démarrage automatique du bureau des agents à l'ouverture de session.
set -eu
LABEL=com.radhouan.bureau-agents
PLIST=~/Library/LaunchAgents/$LABEL.plist
DIR=${0:A:h}
LOGS=~/.bureau-agents

if [[ ${1:-} == --retirer ]]; then
  launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
  rm -f $PLIST
  echo "Démarrage automatique retiré."
  exit 0
fi

NODE=$(command -v node) || { echo "node introuvable dans le PATH"; exit 1; }
mkdir -p $LOGS ~/Library/LaunchAgents
cat > $PLIST <<EOF
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
launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null || true
launchctl bootstrap gui/$(id -u) $PLIST
echo "Bureau des agents démarré : http://localhost:${BUREAU_PORT:-4747}/ (journal : $LOGS/serveur.log)"
