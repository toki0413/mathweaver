# syntax=docker/dockerfile:1
#
# MathWeaver frontend image — React + Vite build served by nginx.
# Multi-stage build: compile the static assets with Node, then serve them from
# a tiny nginx image that also reverse-proxies /api and /ws to the backend.
#

# ---------------------------------------------------------------------------
# Stage 1 — build static assets
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (cached layer). package-lock.json guarantees a
# reproducible install.
COPY package.json package-lock.json ./
RUN npm ci

# Copy only the files required for the build (keeps node_modules out of the
# context and the layer small).
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — serve with nginx
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Drop the default static site shipped with the nginx image.
RUN rm -rf /usr/share/nginx/html/*

# Built assets from the builder stage.
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config: SPA fallback + reverse proxy for /api and /ws to the backend.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
