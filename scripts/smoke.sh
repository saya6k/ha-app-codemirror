#!/usr/bin/env bash
# Smoke test the built app image end-to-end:
#   1. gunicorn comes up under s6 and /health answers
#   2. the frontend bundle is in the image
#   3. the ingress-only guard rejects non-Supervisor clients
#
#   bash scripts/smoke.sh [image-tag]
#
# With no tag the image is built first. On this Mac that means the linux-test
# container machine, where dockerd runs with --bridge=none: DOCKER_NET=--network=host
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE="${1:-}"
NAME=codemirror-smoke
DOCKER_NET="${DOCKER_NET:-}"

if [ -z "${IMAGE}" ]; then
  IMAGE=ha-app-codemirror:test
  # shellcheck disable=SC2086
  docker build ${DOCKER_NET} -t "${IMAGE}" "${HERE}/../codemirror"
fi

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container logs (tail) ---"
    docker logs "$NAME" 2>&1 | tail -40 || true
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
# shellcheck disable=SC2086
docker run -d --name "$NAME" ${DOCKER_NET} \
  -v "${HERE}/ci-options.json:/data/options.json:ro" "$IMAGE" >/dev/null

status_of() {
  docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' -m 2 \
    "http://127.0.0.1:8099$1" 2>/dev/null || true
}

echo "waiting for gunicorn …"
for _ in $(seq 1 30); do
  [ "$(status_of /health)" = "200" ] && break
  sleep 1
done

echo "1/3 /health"
[ "$(status_of /health)" = "200" ]

echo "2/3 frontend bundle"
docker exec "$NAME" test -s /app/static/index.html

echo "3/3 ingress-only guard"
[ "$(status_of /)" = "403" ]
[ "$(status_of /api/roots)" = "403" ]

echo "smoke OK"
