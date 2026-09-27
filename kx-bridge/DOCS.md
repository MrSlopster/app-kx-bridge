# KX-Bridge — Home Assistant add-on

Runs [KX-Bridge](https://gitea.it-drui.de/viewit/KX-Bridge-Release) as a Home
Assistant OS / Supervised add-on. KX-Bridge exposes a **Moonraker-compatible
API** for the **Anycubic Kobra X**, letting you drive the printer from
OrcaSlicer (and view status in Fluidd/Mainsail-style clients) over the printer's
local MQTT interface — no Klipper, no Raspberry Pi.

> This add-on is a community packaging of the upstream project (GPL-3.0). It is
> not affiliated with Anycubic or the upstream author.

## How it works

- Add-on **options** carry the printer connection (IP, MQTT port, credentials,
  device/model IDs). They are exported as environment variables, which the
  bridge treats as the source of truth (they override `config.ini`) and are
  re-applied on every restart.
- Everything else — AMS/print behaviour, Spoolman, filament profiles, ACE dry
  presets, dashboard tiles and **multi-printer** setups — is managed inside the
  **KX-Bridge web UI** and persisted to `config.ini`.

## Storage layout

| Path (in add-on) | Mapped to | Purpose |
| --- | --- | --- |
| `/config/config.ini` | `addon_config` (user-editable, persistent) | All web-UI-managed settings, multi-printer sections |
| `/config/config.ini.example` | same | Reference template, seeded on first start |
| `/data/data` | add-on private data (persistent) | SQLite database, uploaded G-code |

`/config` is reachable with the **Studio Code Server** / **File editor** /
**Samba** add-ons under `addon_configs/…_kx_bridge/` if you want to hand-edit
`config.ini` (e.g. to add `[printer_2]`).

## Getting the connection values

You need values that are specific to *your* printer (MQTT username/password,
device ID). Upstream provides helpers to read them from a running
AnycubicSlicerNext, or directly from the printer:

```
python3 tools/fetch_credentials.py --ip 192.168.x.x --write-config
```

See the upstream `README.md` / `MANUAL.md` for details. Then copy the values
into this add-on's **Configuration** tab.

## Options

| Option | Required | Default | Notes |
| --- | --- | --- | --- |
| `printer_ip` | yes | – | Printer IP on your LAN |
| `mqtt_port` | yes | `9883` | Kobra X default |
| `mqtt_username` | yes | – | Printer-specific, starts with `user…` |
| `mqtt_password` | yes | – | Printer-specific |
| `device_id` | yes | – | 32-char hex, printer-specific |
| `mode_id` | yes | `20030` | Kobra X model ID |
| `bridge_host_ip` | no | – | LAN IP of the HA host, only to make log/URLs show the right address |

Leave the connection options blank if you prefer to manage **all** printers via
`/config/config.ini` (multi-printer). In that case the bridge reads
`[connection]` / `[printer_N]` from the file.

## Ports

| Port | Purpose |
| --- | --- |
| `7125` | Bridge / Moonraker API for printer 1 — **point OrcaSlicer here** |
| `7126`–`7130` | Additional bridge instances for multi-printer setups |

OrcaSlicer connects to `http://<HA-host-IP>:7125` as a Klipper/Moonraker host.
Because slicer clients need the raw port on your LAN, the add-on uses direct
port mapping (no Ingress).

## Multi-printer

1. Leave the connection options blank (or set printer 1 there).
2. Edit `/config/config.ini` and add `[printer_1]`, `[printer_2]`, … sections
   (see `config.ini.example`). Each instance uses the next port (7125, 7126, …).
3. Restart the add-on.

## Camera

`imageio-ffmpeg` ships a static ffmpeg for `amd64`/`aarch64`. On 32-bit ARM
(`armv7`/`armhf`) and `i386` the add-on installs the distro `ffmpeg` package so
the camera works there too.

## Networking notes

- The add-on must be on the **same LAN** as the printer and is **not intended
  for internet exposure**.
- Outbound access to the printer (`<printer_ip>:9883`) and inbound access from
  slicer clients on `7125+` both work with the default bridge networking.

## Updating

The add-on vendors a pinned upstream version (see the add-on version). To move
to a newer KX-Bridge, bump the vendored source and the `version` in
`config.yaml`, then rebuild/update from the Supervisor.
