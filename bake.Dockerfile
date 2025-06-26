FROM node:16.16-alpine

# create app directory
WORKDIR /usr/src/app

RUN addgroup --gid 1301 api \
  && adduser -u 444 -D -G api api \
  && chown -R api:api /usr/src/app

# Copy Koa API
COPY --chown=api:api . /usr/src/app/portal-arcgis-asset-api
RUN cp -r /usr/src/app/portal-arcgis-asset-api/* /usr/src/app
RUN rm -rf /usr/src/app/portal-arcgis-asset-api

# Install app dependencies
RUN cd /usr/src/app && npm ci

# Expose main port
EXPOSE 3100

# Set node for production env
ENV NODE_ENV=production
ENV NODE_MAX_OLD_SPACE_SIZE="512"

# Run as the api user
USER api

# Start the API
ENTRYPOINT exec node --max-old-space-size=$NODE_MAX_OLD_SPACE_SIZE /usr/src/app/api.js
