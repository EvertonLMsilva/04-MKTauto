FROM node:24-bookworm-slim AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig*.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM python:3.12-slim-bookworm AS media-runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 espeak-ng tzdata ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backend/python/alignment/requirements.lock /tmp/alignment.lock
COPY docker/kokoro.lock /tmp/kokoro.lock
# Fail unsupported targets before resolving a different PyTorch build.
RUN python -c "import platform,sys; assert platform.system() == 'Linux' and platform.machine() == 'x86_64' and sys.version_info[:2] == (3,12)" \
    && python -m venv /opt/alignment \
    && /opt/alignment/bin/pip install --no-cache-dir --only-binary=:all: --require-hashes -r /tmp/alignment.lock \
    && /opt/alignment/bin/python -c "import torch; assert torch.__version__ == '2.8.0+cpu' and torch.version.cuda is None and torch.version.hip is None"
RUN python -m venv /opt/kokoro && /opt/kokoro/bin/pip install --no-cache-dir -r /tmp/kokoro.lock && rm /tmp/*.lock

FROM media-runtime AS runtime
COPY --from=backend-build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/package.json
COPY backend/python ./backend/python
# Pin the packaging tool required by the existing model manifest, and provide
# the real executable required by the TTS license verifier (not a symlink).
RUN /opt/alignment/bin/pip install --no-cache-dir pip==25.0.1 && cp --remove-destination /usr/local/bin/python3.12 /opt/kokoro/bin/python
ENV NODE_ENV=production TZ=America/Sao_Paulo HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1
CMD ["node", "backend/dist/main.js"]
