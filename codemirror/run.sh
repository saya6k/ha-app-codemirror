#!/bin/sh
set -eu
export CODEMIRROR_INGRESS_ONLY=1
cd /app
exec gunicorn --bind 0.0.0.0:8099 --workers 1 --threads 4 --timeout 180 --preload app:app
