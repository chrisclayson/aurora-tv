# Aurora configuration — Home Assistant add-on

This folder is a Home Assistant add-on that runs the Aurora configuration UI,
JSON API and a LCN-enriched UK Freeview XMLTV guide centrally for one or more
TVs.

The add-on publishes **port 8090 on the same LAN address as Home Assistant**.
TVs can therefore reach it at `http://homeassistant.local:8090/`.

## Install as a local add-on

1. Copy this whole `config-server/` folder to your Home Assistant add-ons
   directory, for example via the Samba share:

   ```text
   /addons/aurora_config/
     config.yaml
     Dockerfile
     run.sh
     server.js
     epg.js
     public/
     data/
   ```

2. In Home Assistant open **Settings → Add-ons → Add-on store**, refresh, and
   install **Aurora TV Configuration**.
3. Set the add-on options:

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
4. Start it. The sidebar panel **Aurora TV** opens the UI through ingress.
   The same UI is available directly at `http://homeassistant.local:8090/` for
   TVs and for generating bootstrap URLs.

## Endpoints

| URL | Purpose |
| --- | --- |
| `http://homeassistant.local:8090/` | Configuration UI |
| `http://homeassistant.local:8090/api/config/<device-id>` | Per-TV profile |
| `http://homeassistant.local:8090/epg.xml` | UK Freeview XMLTV with `<lcn>` numbers |
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
