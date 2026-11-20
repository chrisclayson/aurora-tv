#!/usr/bin/env sh
set -e

mkdir -p /data/aurora
if [ -z "$(ls -A /data/aurora 2>/dev/null)" ]; then
  cp -R /app/seed/. /data/aurora/
fi

TOKEN=""
PUBLIC=""
if [ -f /data/options.json ]; then
  TOKEN=$(node -e "try{process.stdout.write(String(require('/data/options.json').config_token || ''))}catch(e){}")
  PUBLIC=$(node -e "try{process.stdout.write(String(require('/data/options.json').public_url || ''))}catch(e){}")
fi

export AURORA_CONFIG_DATA=/data/aurora
export AURORA_CONFIG_TOKEN="$TOKEN"
export AURORA_PUBLIC_URL="$PUBLIC"
export PORT=8090
exec node /app/server.js
