#!/usr/bin/env sh
set -e

mkdir -p /data/aurora
if [ -z "$(ls -A /data/aurora 2>/dev/null)" ]; then
  cp -R /app/seed/. /data/aurora/
fi

TOKEN=""
PUBLIC=""
REGION="uk"
EPG_SOURCE=""
EPG_LCN=""
EPG_REFRESH="60"
if [ -f /data/options.json ]; then
  TOKEN=$(node -e "try{process.stdout.write(String(require('/data/options.json').config_token || ''))}catch(e){}")
  PUBLIC=$(node -e "try{process.stdout.write(String(require('/data/options.json').public_url || ''))}catch(e){}")
  REGION=$(node -e "try{process.stdout.write(String(require('/data/options.json').epg_region || 'uk'))}catch(e){}")
  EPG_SOURCE=$(node -e "try{process.stdout.write(String(require('/data/options.json').epg_source_url || ''))}catch(e){}")
  EPG_LCN=$(node -e "try{process.stdout.write(String(require('/data/options.json').epg_lcn_url || ''))}catch(e){}")
  EPG_REFRESH=$(node -e "try{process.stdout.write(String(require('/data/options.json').epg_refresh_minutes || 60))}catch(e){}")
fi

# The add-on shares the Home Assistant host IP. This default lets a TV use
# http://homeassistant.local:8090 even before public_url is set.
if [ -z "$PUBLIC" ]; then
  PUBLIC="http://homeassistant.local:8090"
fi

export AURORA_CONFIG_DATA=/data/aurora
export AURORA_CONFIG_TOKEN="$TOKEN"
export AURORA_PUBLIC_URL="$PUBLIC"
export AURORA_EPG_REGION="$REGION"
export AURORA_EPG_SOURCE_URL="$EPG_SOURCE"
export AURORA_EPG_LCN_URL="$EPG_LCN"
export AURORA_EPG_REFRESH_MINUTES="$EPG_REFRESH"
export PORT=8090
exec node /app/server.js
