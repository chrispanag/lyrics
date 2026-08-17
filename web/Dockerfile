# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Lockfile-only install layer, reused whenever dependencies are unchanged.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables at build time, so they must be present here
# rather than at container start. Changing either requires a rebuild.
ARG VITE_API_BASE_URL
ARG VITE_PRELUDE_APP_ID
ARG VITE_PRELUDE_SDK_KEY
ARG VITE_PRELUDE_SESSION_DOMAIN
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_PRELUDE_APP_ID=$VITE_PRELUDE_APP_ID
ENV VITE_PRELUDE_SDK_KEY=$VITE_PRELUDE_SDK_KEY
ENV VITE_PRELUDE_SESSION_DOMAIN=$VITE_PRELUDE_SESSION_DOMAIN

RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
