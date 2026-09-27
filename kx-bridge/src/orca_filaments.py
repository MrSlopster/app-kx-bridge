"""OrcaSlicer Filament-Profil Parser.

Shared between the generator (tools/gen_orca_filament_list.py) and the
Custom-Profile-Import-Endpoint (bridge/kobrax_moonraker_bridge.py).

Reads Orca filament JSON files (system or user profiles) and returns
them as a normalized list with (id, name, vendor, type, color).
"""
from __future__ import annotations

import json
import logging
import re

log = logging.getLogger("kobrax.filaments")


def first_str(value, default: str = "") -> str:
    """Orca profiles store some fields as ['value']. Returns the first
    element as a string."""
    if isinstance(value, list):
        return str(value[0]) if value else default
    if isinstance(value, str):
        return value
    return default


def clean_name(raw: str) -> str:
    """Strippt printer-/varianten-spezifische Suffixe:
      'PolyTerra PLA @base'                       → 'PolyTerra PLA'
      'Anycubic PLA @Anycubic Kobra X 0.4 nozzle' → 'Anycubic PLA'
      'Anker Generic PLA 0.4 nozzle'              → 'Anker Generic PLA'
    """
    name = re.sub(r"\s*@.*$", "", raw).strip()
    name = re.sub(r"\s+\d+(\.\d+)?\s*nozzle\s*$", "", name, flags=re.IGNORECASE).strip()
    return name or raw


def parse_profile(data: dict, by_name: dict | None = None,
                  path_vendor: str | None = None,
                  source_path: str = "",
                  system_index: list | None = None) -> dict | None:
    """Parses a single Orca filament profile into the bridge schema.

    `by_name` is optionally a {name: [profile, ...]} index for inherits resolution
    from the raw source tree (generator). For single-file imports (user file
    from the OrcaSlicer user dir) we pass `system_index` instead -
    the finished system profile list from orca_filaments.json. This lets
    us derive filament_id/vendor/type/color via the `inherits` chain from
    the system parent even when the user profile does not set these
    fields itself (typically: user override profiles only contain tweaks).

    Returns {id, name, vendor, type, color} or None when the profile
    has no filament_id (e.g. abstract @base templates).
    """
    if not isinstance(data, dict):
        return None
    # User profiles from the OrcaSlicer user dir often set NO "type" field -
    # it comes from the system parent. We accept that when either "type"
    # is explicitly "filament" OR an "inherits" points to another profile.
    if data.get("type") not in (None, "filament") and not data.get("inherits"):
        return None
    if data.get("type") == "filament" and data.get("inherits") is None and not data.get("filament_id"):
        # type=filament but no parent + no ID -> worthless stub
        return None
    inst = data.get("instantiation", "true")
    if isinstance(inst, str) and inst.lower() == "false":
        return None

    # Build the system name index for the fallback lookup when system_index is set.
    sys_by_name: dict[str, dict] = {}
    if system_index:
        for p in system_index:
            if isinstance(p, dict) and p.get("name"):
                pname = p["name"]
                if pname in sys_by_name and sys_by_name[pname] is not p:
                    # clean_name() deliberately collapses variant-suffixed
                    # names (e.g. "...@base" vs "...@Anycubic Kobra X 0.4
                    # nozzle") onto the same cleaned name - expected, but the
                    # last-write-wins overwrite here was previously silent,
                    # making an unexpected inherits-parent resolution hard to
                    # debug.
                    log.debug("orca_filaments: duplicate system profile name %r - "
                              "overwriting %r with %r", pname, sys_by_name[pname].get("id"), p.get("id"))
                sys_by_name[pname] = p

    def _resolve(key: str, depth: int = 5):
        cur_list = [data]
        for _ in range(depth):
            for cur in cur_list:
                v = cur.get(key)
                if v not in ("", [], None, [""]) and v is not None:
                    return v
            # Erst raw-Inherits via by_name (Generator-Pfad)
            if by_name:
                next_list: list[dict] = []
                for cur in cur_list:
                    parent_name = cur.get("inherits")
                    if parent_name and parent_name in by_name:
                        next_list.extend(by_name[parent_name])
                if next_list:
                    cur_list = next_list
                    continue
            break
        return None

    def _resolve_via_system_index(key: str):
        """Inherits chain via system_index (clean_name match)."""
        parent_raw = data.get("inherits")
        if not parent_raw or not sys_by_name:
            return None
        parent_clean = clean_name(parent_raw)
        sys_p = sys_by_name.get(parent_clean)
        if not sys_p:
            return None
        # The system JSON already uses the normalized schema
        mapping = {
            "filament_id":              "id",
            "filament_vendor":          "vendor",
            "filament_type":            "type",
            "default_filament_colour":  "color",
        }
        return sys_p.get(mapping.get(key, key))

    def _resolve_full(key: str):
        v = _resolve(key)
        if v not in ("", [], None, [""]) and v is not None:
            return v
        return _resolve_via_system_index(key)

    fid = _resolve_full("filament_id")
    if not fid or not isinstance(fid, str):
        return None

    name_raw = first_str(data.get("name"), fid)
    name = clean_name(name_raw)
    vendor = first_str(_resolve_full("filament_vendor")) or (path_vendor or "Generic")
    ftype  = first_str(_resolve_full("filament_type"), "")
    color  = first_str(_resolve_full("default_filament_colour"), "")

    return {
        "id":     fid,
        "name":   name,
        "vendor": vendor,
        "type":   ftype,
        "color":  color,
    }


def parse_profile_bytes(blob: bytes, source_name: str = "",
                        system_index: list | None = None) -> dict | None:
    """Reads a single profile from JSON bytes. For the file upload path.
    `system_index` is optionally the finished list from orca_filaments.json -
    used for the inherits resolution of user profiles that do not carry the full
    schema from the system parent."""
    try:
        data = json.loads(blob.decode("utf-8", errors="replace"))
    except Exception:
        return None
    return parse_profile(data, source_path=source_name, system_index=system_index)
