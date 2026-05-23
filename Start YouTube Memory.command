#!/bin/zsh

cd "$(dirname "$0")" || exit 1

clear
echo "Starting YouTube Memory..."
echo
echo "Local URL:"
echo "  http://localhost:4173"
echo

if command -v ipconfig >/dev/null 2>&1; then
  WIFI_IP="$(ipconfig getifaddr en0 2>/dev/null)"
  if [ -n "$WIFI_IP" ]; then
    echo "Wi-Fi URL:"
    echo "  http://$WIFI_IP:4173"
    echo
  fi
fi

if [ -d "/Applications/Tailscale.app" ]; then
  echo "For Tailscale, use the 100.x.x.x address shown in the Tailscale app:"
  echo "  http://YOUR_TAILSCALE_IP:4173"
  echo
fi

echo "Leave this window open while using the app."
echo "Press Control+C to stop the server."
echo

node server.mjs &
SERVER_PID=$!

sleep 1
open "http://localhost:4173" >/dev/null 2>&1

wait "$SERVER_PID"

echo
echo "Server stopped. You can close this window."
read -k 1 "?Press any key to close..."
