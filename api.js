'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const Koa = require('koa');
const Router = require('koa-router');
const Logger = require('koa-logger');
const Favicon = require('koa-favicon');
const Cors = require('@koa/cors');

const cluster = require('cluster');
const cache = require('memored');

const ASSETS_PATH = './assets';
const API_ROOT = '/api/arcgis-assets';
const CPU_COUNT = os.cpus().length;

const logWithPid = (msg, isError = false) => (
  isError
    ? console.error(`[PID ${process.pid}] ERROR: ${msg}`)
    : console.log(`[PID ${process.pid}] ${msg}`)
);

/**
   General Cache Functions
*/
const promiseCacheStore = (key, value) => new Promise ((resolve, reject) => {
  cache.store(key, value, (err) => {
    if (err) { reject(); }
    resolve();
  });
});

const promiseCacheRead = (key) => new Promise ((resolve, reject) => {
  cache.read(key, (err, value) => {
    if (err) { reject(); }
    resolve(value);
  });
});

const cacheIsInitialized = async () => await promiseCacheRead('initialized');

/**
   Features Cache Functions
   features.json is generated from build.js. It expresses a structure containing all valid
   feature keys and site codes for each feature. We use it to build our cache of assets as well
   as to validate paths without having to check the file system.
*/
const cacheFeatures = async () => {
  try {
    const stats = fs.statSync('./features.json');
    const features = JSON.parse(fs.readFileSync('./features.json'));
    await promiseCacheStore('features', features);
    return true;
  } catch (err) {
    logWithPid(err, true);
    return false;
  }  
};

const getFeatures = async () => await promiseCacheRead('features');

/**
   Asset Cache Functions
   features.json is generated from build.js. It expresses a structure containing all valid
   feature keys and site codes for each feature. We use it to build our cache of assets as well
   as to validate paths without having to check the file system.
*/
const getAssetKey = (feature, siteCode) => `${feature}.${siteCode}`;

const cacheAllAssets = async () => {
  const features = await getFeatures();
  const cachePromises = [];
  Object.keys(features).forEach((feature) => {
    features[feature].forEach((siteCode) => {
      const assetKey = getAssetKey(feature, siteCode);
      const assetPath = path.join(ASSETS_PATH, feature, `${siteCode}.json`);
      const promise = fs.promises.readFile(assetPath)
        .then(assetData => promiseCacheStore(assetKey, assetData.toJSON()))
        .catch(error => {
          const annotatedError = `Asset ${assetKey} failed to load and cache; ${error}`;
          logWithPid(annotatedError);
          throw(annotatedError);
        });
      cachePromises.push(promise);
    });
  });
  return Promise.allSettled(cachePromises);
}

const getAssetData = (feature, siteCode) => {
  const assetKey = getAssetKey(feature, siteCode);
  return new Promise ((resolve, reject) => {
    cache.read(assetKey, (err, assetData) => {
      if (err || assetData === undefined) { return resolve(); }
      resolve(Buffer.from(assetData));
    });
  });
};

/**
   verifyOrBuildCache
   Main function to either trigger all build events to warm the cache or confirm it's already ready
*/
const verifyOrBuildCache = async () => {
  const isInitialized = await cacheIsInitialized();
  if (isInitialized) {
    logWithPid('Cache already initialized by another worker');
    return true;
  } else {
    // Handle caching of features.json
    const featuresAreCached = await cacheFeatures();
    if (!featuresAreCached) {
      process.send({
        error: 'Unable to start API: features.json missing or malformed. Run build.js to regenrate.'
      });
      return false;
    }
    logWithPid('Cached features.json');
    // Build the rest of the cache
    logWithPid('Caching assets...');
    const assetCacheResults = await cacheAllAssets();
    const successfulAssets = assetCacheResults.filter(res => res.status === 'fulfilled').length;
    const failedAssets = assetCacheResults.length - successfulAssets;
    logWithPid(`Asset cache: ${successfulAssets} of ${assetCacheResults.length} OK; ${failedAssets} failed.`);
    // Mark cache as initialized and inform the master that the cache is ready
    await promiseCacheStore('initialized', true);
    logWithPid('Cache is now ready');
    process.send({ cacheIsReady: true });
    return true;
  }
};

/**
   Master thread - validate environment and spawn forks
*/
if (cluster.isMaster) {
  logWithPid(`Master is running; ${CPU_COUNT} available CPUs`);

  // Spawn first worker to warm the cache. Listen for messages and kill the master thread if cache
  // building failed for any reason. Otherwise spawn the remaining workers.
  const cacheWarmer = cluster.fork();
  cacheWarmer.on('message', (msg) => {
    if (msg.error) {
      clogWithPid(msg.error, true);
      process.exit(1);
    }
    if (msg.cacheIsReady && CPU_COUNT > 1) {
      for (let i = 1; i < CPU_COUNT; i++) {
        cluster.fork();
      }
    }
  });

/**
   Workers - Confirm existence of cache or initialize it if missing and start the API
*/
} else {

  verifyOrBuildCache()
    .then(async (cacheIsReady) => {
      if (!cacheIsReady) { process.exit(1); }

      /**
         Initialization
      */
      const api = new Koa();
      const router = new Router();
      api.use(Cors({ origin: '*', allowMethods: ['GET'] }));
      api.use(Logger());
      api.use(Favicon(__dirname + '/public/favicon.ico'));

      /**
         Features
      */
      const features = await getFeatures();

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
        ctx.body = assetData;
      });

      /**
         Start the API
      */
      api.use(router.routes());
      api.use(router.allowedMethods());
      api.listen(3100);
      logWithPid('Worker started');
    });

}
