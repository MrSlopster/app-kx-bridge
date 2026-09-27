# Changelog

## 0.9.30-nightly17

- Initial Home Assistant add-on packaging of KX-Bridge 0.9.30-nightly17.
- Connection settings exposed as add-on options (source of truth via env vars).
- `config.ini` persisted and user-editable at `/config` (addon_config map).
- Runtime state (SQLite, G-code) persisted at `/data/data` via `KX_DATA_DIR`.
- s6-overlay longrun service; supports the bridge's in-container self-restart.
- Multi-arch: aarch64, amd64, armv7, armhf, i386 (ffmpeg apt fallback on 32-bit/i386).
