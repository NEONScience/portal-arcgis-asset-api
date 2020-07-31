'use strict';

const fs = require('fs');
const path = require('path');

const Koa = require('koa');
const Router = require('koa-router');
const Logger = require('koa-logger');
const Favicon = require('koa-favicon');
const Cors = require('@koa/cors');

const cluster = require('cluster');
const cache = require('memored');
const { gzip } = require('node-gzip');

const ASSETS_PATH = './assets';
const API_ROOT = '/api/arcgis-assets';

/**
   Features
   features.json is generated from build.js. It expresses a structure containing all valid
   feature keys and site codes for each feature. We use it to build our cache of assets as well
   as to validate paths without having to check the file system.
*/
let features = {};
try {
  const stats = fs.statSync('./features.json');
  features = JSON.parse(fs.readFileSync('./features.json'));
} catch (err) {
  console.error('Unable to start API: features.json missing or malformed. Run build.js to regenrate.');
  process.exit(1);
}

/**
   Cache helper functions
*/
const getCacheKey = (feature, siteCode) => `${feature}.${siteCode}`;
const getAssetData = (feature, siteCode) => {
  const assetKey = getCacheKey(feature, siteCode);
  return new Promise ((resolve, reject) => {
    cache.read(assetKey, (err, assetData) => {
      if (err) { reject(); }
      resolve(Buffer.from(assetData));
    });
  });
};

/**
   Master thread - fork and set up cache
*/
if (cluster.isMaster) {
  cluster.fork();

/**
   Child threads - Run API
*/
} else {

  /**
     API Initialization
  */
  const api = new Koa();
  const router = new Router();
  api.use(Cors({ origin: '*', allowMethods: ['GET'] }));
  api.use(Logger());
  api.use(Favicon(__dirname + '/public/favicon.ico'));

  /**
     Cache
     The total asset footprint is only a few megabytes, so load everything into a simple
     in-memory cache. Gzip all JSON as we populate the cache since it doesn't change.
  */
  const cachePromises = [];
  Object.keys(features).forEach((feature) => {
    features[feature].forEach((siteCode) => {
      const assetKey = getCacheKey(feature, siteCode);
      const assetPath = path.join(ASSETS_PATH, feature, `${siteCode}.json`);
      const promise = fs.promises.readFile(assetPath)
        .then((uncompressedData) => gzip(uncompressedData))
        .then((compressedData) => {
          return new Promise ((resolve, reject) => {
            cache.store(assetKey, compressedData.toJSON(), (err) => {
              if (err) { reject(); }
              resolve();
            });
          });
        });
      cachePromises.push(promise);
    });
  });

  /**
     Routes
  */
  // /health - health check; if we're running we're good.
  // Buried below API root since it's only checked internally.
  router.get('/health', (ctx, next) => {
    ctx.status = 200;
  });

  // {API_ROOT} - list all feature keys
  router.get(`${API_ROOT}/`, (ctx, next) => {
    ctx.body = {
      features: Object.keys(features),
    };
  });

  // {API_ROOT}/{FEATURE} - list all valid Site Codes for a given Feature
  router.get(`${API_ROOT}/:feature`, (ctx, next) => {
    if (!Object.keys(features).includes(ctx.params.feature)) {
      ctx.status = 400;
      ctx.body = 'Invalid Feature';
      return;
    }
    ctx.body = {
      siteCodes: features[ctx.params.feature],
    };
  });

  // {API_ROOT}/{FEATURE}/{SITECODE} - return the corresponding asset JSON
  router.get(`${API_ROOT}/:feature/:siteCode`, async (ctx, next) => {
    if (!Object.keys(features).includes(ctx.params.feature)) {
      ctx.status = 400;
      ctx.body = 'Invalid Feature';
      return;
    }
    if (!features[ctx.params.feature].includes(ctx.params.siteCode)) {
      ctx.status = 400;
      ctx.body = 'Site Code not valid for this Feature';
      return;
    }
    const assetData = await getAssetData(ctx.params.feature, ctx.params.siteCode);
    if (assetData === undefined) {
      ctx.status = 404;
      ctx.body = 'Feature and Site Code are valid but asset not found';
      return;
    }
    ctx.set('Content-Type', 'application/json');
    ctx.set('Content-Encoding', 'gzip');
    ctx.body = assetData;
  });
  
  /**
     Start the API once cache is populated
  */
  Promise.all(cachePromises).then((assets) => {
    console.log(`${assets.length} Assets read into cache`);
    api.use(router.routes());
    api.use(router.allowedMethods());
    api.listen(3100);
  });

}
