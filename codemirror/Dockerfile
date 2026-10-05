# BUILD_FROM is no longer injected by the Supervisor (>=2026.04.0) — default to
# the multi-arch HA base manifest, pinned to an Alpine version tag instead of
# the moving :latest. Overridable with --build-arg.
# Declared before any FROM so it is a global ARG (stage-scoped ARGs are empty
# in a later FROM).
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.23

# ---- Frontend build stage --------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/styles.css frontend/tsconfig.json frontend/vite.config.ts ./
# Keep the source directory explicit: incomplete installs must fail at COPY.
COPY frontend/src/ ./src/
COPY frontend/public/ ./public/
RUN npm run build

# ---- Runtime ---------------------------------------------------------------
FROM ${BUILD_FROM}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# The base image is labeled io.hass.type=base and build-image only stamps
# io.hass.arch/version, so without this the add-on image inherits "base".
LABEL io.hass.type="app"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt /tmp/requirements.txt
RUN apk add --no-cache python3 py3-pip \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

WORKDIR /app
COPY app.py filesystem.py file_actions.py archive_upload.py LICENSE.md ./
COPY branding/ ./branding/
COPY --from=frontend /static ./static

# ---- rootfs (s6 services) --------------------------------------------------
COPY rootfs /

RUN find /etc/s6-overlay/s6-rc.d -type f \( -name run -o -name finish \) -exec chmod a+x {} \; \
 && find /etc/s6-overlay/s6-rc.d -type f -name type -exec chmod 644 {} \;

WORKDIR /

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["curl", "-fs", "-o", "/dev/null", "http://127.0.0.1:8099/health"]
