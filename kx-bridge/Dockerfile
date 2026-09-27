ARG BUILD_FROM
FROM ${BUILD_FROM}

# BUILD_ARCH is injected automatically by the Home Assistant builder
ARG BUILD_ARCH

ENV LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Build deps + Python. imageio-ffmpeg ships a static ffmpeg for amd64/aarch64
# only; 32-bit ARM and i386 have no static binary, so pull the apt package
# there (otherwise the camera never starts).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-dev \
        gcc \
    && if [ "${BUILD_ARCH}" = "armv7" ] || [ "${BUILD_ARCH}" = "armhf" ] || [ "${BUILD_ARCH}" = "i386" ]; then \
         apt-get install -y --no-install-recommends ffmpeg; \
       fi \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY src/requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt \
    && apt-get purge -y gcc python3-dev \
    && apt-get autoremove -y

# Application (mirrors the upstream Dockerfile COPY set)
COPY src/kobrax_moonraker_bridge.py .
COPY src/web/ ./web/
# Static assets (orca_filaments.json, ...) live in /app/static; /data is the
# runtime volume, /config holds config.ini (both wired up at runtime in run).
COPY src/data/ ./static/
COPY src/config_loader.py .
COPY src/env_loader.py .
COPY src/kobrax_client.py .
COPY src/orca_filaments.py .
COPY src/VERSION .
COPY src/anycubic_slicer.crt .
COPY src/anycubic_slicer.key .
COPY src/config.ini.example ./config.ini.example

RUN mkdir -p /app/config /data/data

# s6-overlay service definition + run script
COPY rootfs /

# Home Assistant add-on labels
ARG BUILD_DATE
ARG BUILD_REF
ARG BUILD_VERSION
LABEL \
    io.hass.name="KX-Bridge" \
    io.hass.description="Moonraker-compatible bridge for the Anycubic Kobra X" \
    io.hass.type="addon" \
    io.hass.arch="aarch64|amd64|armv7|armhf|i386" \
    io.hass.version="${BUILD_VERSION}"
