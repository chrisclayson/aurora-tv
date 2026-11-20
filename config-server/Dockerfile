ARG BUILD_FROM=node:20-alpine
FROM ${BUILD_FROM}

WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY data ./seed
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV PORT=8090
EXPOSE 8090
CMD ["/run.sh"]
