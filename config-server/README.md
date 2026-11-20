# Aurora configuration — Home Assistant add-on

This folder is a Home Assistant add-on that runs the Aurora configuration UI
and JSON API centrally for one or more TVs.

## Install as a local add-on

1. Copy this whole `config-server/` folder to your Home Assistant add-ons
   directory, for example via the Samba share:

   ```text
   /addons/aurora_config/
     config.yaml
     Dockerfile
     run.sh
     server.js
     public/
     data/
   ```

2. In Home Assistant open **Settings → Add-ons → Add-on store**, refresh, and
   install **Aurora TV Configuration**.
3. Set the add-on options:

   ```yaml
   config_token: "choose-a-token"
   public_url: "http://<HA-IP>:8090"   # HA LAN address, for bootstrap URLs
   ```

4. Start it. The sidebar panel **Aurora TV** opens the UI through ingress.
   The same UI is available directly at `http://<HA-IP>:8090/` for TVs and for
   generating bootstrap URLs.

## TVs

Point each TV's remote config at:

```text
http://<HA-IP>:8090/api/config/<device-id>
```

with the add-on's `config_token` as the bearer token. Or download the device's
bootstrap `config.json` from the UI and install it once.

Profiles are stored in `/data/aurora/` inside the add-on container, so they
survive add-on updates and restarts. `data/example.json` is the tracked example
profile; create one profile per TV in the UI. Local profiles under `data/` are
git-ignored.

## Direct Node server

The same server still runs outside Home Assistant:

```bash
AURORA_CONFIG_TOKEN=secret AURORA_CONFIG_DATA=./data PORT=8090 node server.js
```

The add-on adds ingress, persistent storage and the Home Assistant sidebar
panel; the API is identical.
