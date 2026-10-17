# Build the web client. Plain JS comes out, the same for every CPU: build it once, natively, even for arm64 images.
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Backend; also serves the built client from the same origin.
FROM python:3.13-slim
WORKDIR /app
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Runs as this unprivileged user; deploy/install.sh gives it the data folder.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin gomex
COPY server/app.py ./
COPY server/gomex ./gomex
COPY --from=web /web/dist ./web
ENV WEB_DIST=/app/web \
    DATA_DIR=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
VOLUME ["/data"]
USER 10001:10001
# Host networking: only Caddy on the same machine talks to this port.
CMD ["uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", "--no-server-header"]
