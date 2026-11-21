ARG BUILD_FROM=ghcr.io/home-assistant/base:3.23
FROM ${BUILD_FROM}

# Home Assistant base images are Alpine-based. Node.js is all the configuration
# server and EPG service need (there are no npm dependencies).
RUN apk add --no-cache nodejs ca-certificates

WORKDIR /app
COPY package.json server.js epg.js ./
COPY public ./public
COPY data/example.json ./seed/example.json
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV PORT=8090
EXPOSE 8090

LABEL \
  org.opencontainers.image.title="Aurora TV Configuration" \
  org.opencontainers.image.description="Central Aurora TV configuration, UK Freeview EPG and TV API" \
  org.opencontainers.image.source="https://github.com/chrisclayson/aurora-tv" \
  org.opencontainers.image.licenses="MIT"

CMD ["/run.sh"]
