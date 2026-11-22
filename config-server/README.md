# Aurora configuration — Home Assistant add-on

This folder is a Home Assistant add-on that runs the Aurora configuration UI,
JSON API and a LCN-enriched UK Freeview XMLTV guide centrally for one or more
TVs.

The add-on publishes **port 8090 on the same LAN address as Home Assistant**.
TVs can therefore reach it at `http://homeassistant.local:8090/`.

## Install from the GitHub repository

1. In Home Assistant open **Settings → Add-ons → Add-on store**.
2. Open the **⋮** menu → **Repositories**.
3. Add:

   ```text
   https://github.com/chrisclayson/aurora-tv
   ```

4. Find **Aurora TV Configuration** under the **Aurora TV** repository and
   install it.
5. Set the add-on options:

   ```yaml
   config_token: "choose-a-token"
   public_url: "http://homeassistant.local:8090"
   epg_region: uk
   epg_source_url: "https://raw.githubusercontent.com/dp247/Freeview-EPG/master/epg.xml"
   epg_lcn_url: "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_DTT_channels_in_the_United_Kingdom&prop=wikitext&format=json&origin=*"
   epg_refresh_minutes: 60
   ```

   `public_url` is used for generated bootstrap URLs. It defaults to
   `http://homeassistant.local:8090` when left empty.
6. Start it. The sidebar panel **Aurora TV** opens the UI through ingress.
   The same UI is available directly at `http://homeassistant.local:8090/` for
   TVs and for generating bootstrap URLs.

The add-on builds on device from the multi-arch Home Assistant Alpine base
image (`ghcr.io/home-assistant/base:3.23`) and installs Node.js from Alpine
packages. It supports `aarch64`, `armv7` and `amd64`, so it builds on Raspberry
Pi OS 64-bit and 32-bit Home Assistant installations. No prebuilt image or
separate build server is required.

The add-on uses `host_network: true`, so it shares the Home Assistant host's
network. This lets it reach TVs on other VLANs/subnets when the HA host can
route to them.

### Local add-on alternative

If you prefer not to add the Git repository, copy the `config-server/` folder to
`/addons/aurora_config/` and install it as a local add-on. Keep
`config.yaml` at the add-on folder root.

## Endpoints

| URL | Purpose |
| --- | --- |
| `http://homeassistant.local:8090/` | Configuration UI |
| `http://homeassistant.local:8090/api/config/<device-id>` | Per-TV profile |
| `http://homeassistant.local:8090/epg.xml` | UK Freeview XMLTV with `<lcn>` numbers |
| `POST /api/import/tv` | Import an existing TV by IP |
| `http://homeassistant.local:8090/api/health` | Liveness check |

The EPG feed is public (no bearer token) so TVs can load it as a normal XMLTV
URL. Configuration endpoints use the add-on's `config_token`.

### EPG updates

The add-on refreshes the guide once an hour by default:

- `epg_region` selects the UK region preset (`uk`, `uk-london`,
  `uk-scotland`, `uk-wales`, `uk-northern-ireland`).
- `epg_source_url` is the external XMLTV feed. The default is the
  `dp247/Freeview-EPG` feed.
- `epg_lcn_url` supplies the Freeview LCN list. The default is the current UK
  DTT channel table from Wikipedia; a built-in fallback covers the main PSB
  channels if it cannot be reached.
- `epg_refresh_minutes` controls the refresh interval (1–1440, default 60).

The web UI's **TV guide** card shows the direct `/epg.xml` URL and has a
**Refresh add-on guide** button.

## Import an existing TV

1. On the TV open **Settings → On-TV web configuration** and read the
   six-character **Import code**.
2. In the add-on UI open the **↓** button beside **Devices** and enter the TV's
   IP address plus the six-character code.
3. The TV's profile is read from port 8099 and stored in the add-on.

The import code is created fresh each time Settings opens. Settings rotates the
on-TV server's access token to that code in place, so port 8099 is never
restarted. Closing Settings or backgrounding Aurora restores the normal token,
which invalidates the code. An existing profile with the same device ID is
replaced.

The add-on first checks `http://<TV-IP>:8099/api/health` and then reads the
profile over a fresh `Connection: close` socket. If the health check times out,
the TV is not routable from the HA host on port 8099 — check the TV IP,
VLAN/routing rules and firewall. The on-TV server itself has no subnet
restriction and listens on all interfaces. A stale connection can no longer
wedge it: the server drops idle sockets after 750 ms.

## Push a saved profile to a TV

1. Select the device, make your edits and press **Save changes**.
2. Press **Push to TV** (the ↑ button, or the button above the editor).
3. On the TV open **Settings → On-TV web configuration** and read the
   six-character **Import code**.
4. Enter the TV's IP address and code in the add-on and press **Push to TV**.

This uses the same protections as an import: the public health check, a fresh
`Connection: close` socket, and the six-character code in the
`X-Aurora-Token` header. The code only works while Settings is open. The TV
applies the pushed profile when Settings closes.

`remoteConfig` and `localServer` are removed from the pushed profile. The TV
keeps its own remote-sync URL/token and local web-server settings, so pushing
an old profile cannot stop it polling this add-on or change its access token.

The **Appearance** card also controls the soft navigation sounds, the Samsung
Hub tile, and the Art Mode tile on Frame TVs. After tiles are hidden, Aurora
reassigns their accents so two identical colours are never adjacent, including
in festive mode.

## TVs

Point each TV's Home Assistant URL at `http://homeassistant.local:8123`, and its
XMLTV URL at `http://homeassistant.local:8090/epg.xml`.

Point remote config at:

```text
http://homeassistant.local:8090/api/config/<device-id>
```

with the add-on's `config_token` as the bearer token. Or download the device's
bootstrap `config.json` from the UI and install it once.

Profiles are stored in `/data/aurora/` inside the add-on container, so they
survive add-on updates and restarts. `data/example.json` is the tracked example
profile; create one profile per TV in the UI.

## Direct Node server

The same server still runs outside Home Assistant:

```bash
AURORA_CONFIG_TOKEN=secret AURORA_CONFIG_DATA=./data PORT=8090 node server.js
```

Optional EPG variables: `AURORA_EPG_REGION`, `AURORA_EPG_SOURCE_URL`,
`AURORA_EPG_LCN_URL`, `AURORA_EPG_REFRESH_MINUTES`.

The add-on adds ingress, persistent storage and the Home Assistant sidebar
panel; the API and EPG feed are identical.
