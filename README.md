# KX-Bridge Home Assistant Add-on

Packages [KX-Bridge](https://gitea.it-drui.de/viewit/KX-Bridge-Release), a
Moonraker-compatible bridge for the **Anycubic Kobra X**, as a Home Assistant
add-on. Control the printer from OrcaSlicer through Home Assistant, without
Klipper or a separate Raspberry Pi.

## Install

1. Home Assistant → **Settings → Add-ons → Add-on Store**.
2. Overflow menu (⋮) → **Repositories** → add this repository's URL.
3. Install **KX-Bridge**, open **Configuration**, fill in your printer's
   connection details, then **Start**.
4. In OrcaSlicer, add a printer host of type Klipper/Moonraker pointing at
   `http://<home-assistant-ip>:7125`.

The add-on's **Documentation** tab (`kx-bridge/DOCS.md`) covers credentials,
multi-printer setups, and the storage layout.

## Contents

```
repository.yaml            # marks this folder as an HA add-on repository
kx-bridge/
  config.yaml              # add-on manifest (options, ports, schema)
  build.yaml               # per-arch HA base images
  Dockerfile               # HA-style build (Debian bookworm base)
  rootfs/                  # s6-overlay longrun service + run script
  src/                     # vendored KX-Bridge application source
  DOCS.md / CHANGELOG.md   # documentation
  icon.png / logo.png
```

Upstream is GPL-3.0. This packaging is an independent community effort, not
affiliated with Anycubic or the upstream author.
