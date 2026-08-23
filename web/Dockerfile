# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Lockfile-only install layer, reused whenever dependencies are unchanged.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Next inlines NEXT_PUBLIC_* variables at build time, so they must be present
# here rather than at container start. Changing either requires a rebuild.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_PRELUDE_APP_ID
ARG NEXT_PUBLIC_PRELUDE_SDK_KEY
ARG NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN
ARG NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_PRELUDE_APP_ID=$NEXT_PUBLIC_PRELUDE_APP_ID
ENV NEXT_PUBLIC_PRELUDE_SDK_KEY=$NEXT_PUBLIC_PRELUDE_SDK_KEY
ENV NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN=$NEXT_PUBLIC_PRELUDE_SESSION_DOMAIN
ENV NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID=$NEXT_PUBLIC_PRELUDE_OTP_LOGIN_CONFIG_ID

# The Turbopack build cache is most of what `next build` leaves behind (~32 MB
# of a 38 MB .next) and `next start` never reads it, so it is dropped rather
# than copied into the runtime layer below. Deleted in the same step as the
# build, not a step after it: a `RUN` of its own leaves the cache sitting in the
# layer beneath, which the runtime image does not carry but CI's
# `cache-to: mode=max` exports along with every other stage's layers. The
# `COPY . .` above invalidates it on any source change anyway, so there is
# nothing to keep it for.
RUN npm run build && rm -rf .next/cache

# --- runtime -----------------------------------------------------------------
# A Node runtime rather than the nginx one this image used to end in: the app is
# served by `next start` now, so there is no directory of static files to hand
# to a web server, and nginx.conf is gone with it. What it declared lives in
# next.config.ts (the security headers) or is Next's own default (immutable
# caching for /_next/static, no-store for documents, gzip).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only. `next start` needs `next` itself and nothing
# that built the app, and it reads next.config.ts with its own bundled
# toolchain, so typescript does not have to be here for a .ts config.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

# CMD rather than ENTRYPOINT, for the reason .do/app.yaml gives about the API
# image: `run_command` replaces a component's command, and with an ENTRYPOINT in
# place it may be appended to it as arguments instead.
CMD ["npm", "start"]
