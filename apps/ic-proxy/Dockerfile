# ic-proxy — backend de datos, para Cloud Run.
#
# Multi-etapa: la imagen final solo lleva la salida `standalone` de Next (el servidor y las
# dependencias que realmente importa), no los 219 paquetes de node_modules. Con eso la imagen
# baja de cientos de MB a decenas, que en Cloud Run se traduce en arranques en frío más cortos.

# ── 1. Dependencias ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
# Solo los manifiestos: así esta capa se reutiliza mientras no cambien las dependencias,
# aunque cambie el código. `npm ci` y no `install` porque debe respetar el lock exacto.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ── 2. Construcción ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# Sentry solo sube sourcemaps si hay token; sin él el build sigue adelante en silencio
# (ver sourcemaps.disable en next.config.mjs).
ARG SENTRY_AUTH_TOKEN=""
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. Imagen final ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Usuario sin privilegios: si algún día se cuela una ejecución de código, que no sea root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# `public/` puede no existir en un proyecto de solo API; el punto final lo hace opcional.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs

# Cloud Run inyecta PORT y espera que el proceso escuche en 0.0.0.0. Si el servidor se ata a
# localhost, los health checks fallan y el despliegue se queda en bucle sin decir por qué.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
