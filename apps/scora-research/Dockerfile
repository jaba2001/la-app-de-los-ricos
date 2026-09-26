# scora-research — la app, para Cloud Run.
#
# ⚠ LO QUE MÁS SE EQUIVOCA AL CONTENERIZAR NEXT: las variables NEXT_PUBLIC_* NO se leen al
# arrancar. Next las SUSTITUYE POR SU VALOR dentro del JavaScript que va al navegador, y eso
# pasa al COMPILAR. Si se pasan como variables de entorno de Cloud Run en vez de como
# argumentos de build, la app arranca perfectamente y luego no encuentra ni Supabase ni el
# proxy — sin un solo error en los logs del servidor, porque el fallo está en el navegador.
#
# Por eso van aquí como ARG: son parte de la construcción de la imagen. Consecuencia
# práctica: cambiar el NEXT_PUBLIC_PROXY_URL obliga a reconstruir, no basta con redesplegar.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .

# ── Lo que se incrusta en el bundle del navegador ────────────────────────────────────
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_PROXY_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_AI_PROVIDER
ARG NEXT_PUBLIC_BATCH_DISABLED
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_PROXY_URL=$NEXT_PUBLIC_PROXY_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_AI_PROVIDER=$NEXT_PUBLIC_AI_PROVIDER \
    NEXT_PUBLIC_BATCH_DISABLED=$NEXT_PUBLIC_BATCH_DISABLED

# Solo para subir sourcemaps; sin token el build sigue igual (sourcemaps.disable).
ARG SENTRY_AUTH_TOKEN=""
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN SENTRY_ORG=$SENTRY_ORG SENTRY_PROJECT=$SENTRY_PROJECT
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# public/ lleva el service worker que genera next-pwa (sw.js, push-sw.js) y los iconos.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
