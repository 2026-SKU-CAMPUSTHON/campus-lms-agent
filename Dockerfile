FROM node:24.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend/ backend/
COPY frontend/ frontend/
RUN npm run build && npm prune --omit=dev

FROM node:24.13.0-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates gosu libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/ worker/
RUN python3 -m venv /opt/worker && /opt/worker/bin/pip install --no-cache-dir -r worker/requirements-youtube.txt
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/backend/dist/ backend/dist/
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/frontend/dist/ frontend/dist/
COPY package.json ./
COPY mysql/ mysql/
COPY deploy/entrypoint.sh /usr/local/bin/campus-entrypoint
RUN chmod 755 /usr/local/bin/campus-entrypoint && mkdir /data && chown node:node /data
ENV NODE_ENV=production ENABLE_DEMO_AUTH=false HOST=0.0.0.0 PORT=3000 DATA_DIR=/data PYTHON_BIN=/opt/worker/bin/python YOUTUBE_PYTHON_BIN=/opt/worker/bin/python
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["campus-entrypoint"]
CMD ["node", "backend/dist/index.js"]
