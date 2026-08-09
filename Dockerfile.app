# Self-contained, from-source build of the Medplum admin app (@medplum/app) for
# self-hosting (Coolify / plain docker compose). Builds the Vite app from the FULL
# monorepo workspace so local @medplum/* customizations (Premier Health branding in
# packages/react + packages/app/static + index.html) are baked in, instead of the
# upstream medplum/medplum-app image. Runtime config (API URL, etc.) uses the same
# placeholder-token scheme as upstream: tokens are inlined at build time and
# docker-entrypoint.sh sed-replaces them from env vars at container start.

# Stage 1: build the app (and its workspace deps) from source.
FROM node:24-bookworm-slim AS build
WORKDIR /usr/src/medplum
COPY . .
RUN npm ci
# Build dist (via esbuild, NOT the packages' full `build` whose tsc step type-checks
# a test importing react-router-dom, not a dep, and fails on a clean install) for the
# @medplum packages in the app's runtime graph, so vite resolves non-aliased
# transitive deps. Building react here also emits dist/esm/index.css, imported as
# '@medplum/react/styles.css'.
RUN set -eux; for p in core react-hooks react fhir-router mock campaigns; do \
      if [ -f "packages/$p/esbuild.mjs" ]; then ( cd "packages/$p" && node esbuild.mjs ); fi; \
    done
# Inline runtime-config placeholder tokens. The app reads import.meta.env.MEDPLUM_*
# (vite envPrefix MEDPLUM_/GOOGLE_/RECAPTCHA_); .env.production.local has the highest
# precedence so it overrides the committed .env. docker-entrypoint.sh replaces these
# tokens with real env values at container start.
RUN printf 'MEDPLUM_BASE_URL=__MEDPLUM_BASE_URL__\nMEDPLUM_CLIENT_ID=__MEDPLUM_CLIENT_ID__\nGOOGLE_CLIENT_ID=__GOOGLE_CLIENT_ID__\nRECAPTCHA_SITE_KEY=__RECAPTCHA_SITE_KEY__\nMEDPLUM_REGISTER_ENABLED=__MEDPLUM_REGISTER_ENABLED__\nMEDPLUM_AWS_TEXTRACT_ENABLED=__MEDPLUM_AWS_TEXTRACT_ENABLED__\n' > packages/app/.env.production.local
RUN cd packages/app && npx vite build

# Stage 2: serve the static SPA via unprivileged nginx on 3000; the entrypoint
# injects runtime config into the built assets before starting nginx.
FROM nginxinc/nginx-unprivileged:alpine
USER root
COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
    }
}
EOF
COPY --from=build /usr/src/medplum/packages/app/dist /usr/share/nginx/html
COPY packages/app/docker-entrypoint.sh /docker-entrypoint.sh
RUN chown -R 101:101 /usr/share/nginx/html && \
    chown 101:101 /docker-entrypoint.sh && \
    chmod +x /docker-entrypoint.sh
EXPOSE 3000
USER 101
ENTRYPOINT ["/docker-entrypoint.sh"]
