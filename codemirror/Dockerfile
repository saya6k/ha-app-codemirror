FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/index.html frontend/styles.css frontend/tsconfig.json frontend/vite.config.ts ./
# Keep the source directory explicit: incomplete installs must fail at COPY.
COPY frontend/src/ ./src/
RUN npm run build

FROM python:3.12-alpine
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py filesystem.py file_actions.py LICENSE.md ./
COPY --from=frontend /static ./static
COPY run.sh /run.sh
RUN chmod +x /run.sh
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8099/health')"
CMD ["/run.sh"]
