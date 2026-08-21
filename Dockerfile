# syntax=docker/dockerfile:1

# ── Stage 1: Frontend ─────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend

WORKDIR /plugin

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

COPY src/ ./src/
COPY webpack.config.js tsconfig.json ./

RUN npm run build


# ── Stage 2: Go Backend ───────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend

ARG TARGETOS=linux
ARG TARGETARCH=amd64

WORKDIR /workspace/plugin

# Nur go.mod + go.sum — kein Quellcode.
# Dieser Layer bleibt gecacht solange sich Abhängigkeiten nicht ändern.
COPY go.mod go.sum ./

RUN --mount=type=cache,target=/root/go/pkg/mod \
    go mod download

# Quellcode erst nach dem Download — Änderungen invalidieren nur den Build-Layer.
COPY pkg/ ./pkg/

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -o /out/gpx_metricq_datasource_${TARGETOS}_${TARGETARCH} ./pkg/


# ── Stage 3: Grafana mit Plugin ───────────────────────────────────────────────
FROM grafana/grafana:13.1.0

ENV GF_PATHS_PLUGINS=/usr/share/grafana/plugins

COPY --from=frontend /plugin/dist/ /usr/share/grafana/plugins/metricq-metricq-datasource/
COPY --from=backend /out/ /usr/share/grafana/plugins/metricq-metricq-datasource/

ENV GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=metricq-metricq-datasource

USER grafana
