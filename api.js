'use strict';

const fs = require('fs');
const path = require('path');

const Koa = require('koa');
const Router = require('koa-router');
const Logger = require('koa-logger');
const Favicon = require('koa-favicon');
const NodeCache = require('node-cache');

const api = new Koa();
const router = new Router();
api.use(Logger());
api.use(Favicon(__dirname + '/public/favicon.ico'));

const ASSETS_PATH = './assets';

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
const getAssetKey = (feature, siteCode) => `${feature}.${siteCode}`;

/**
   Initialize Cache
*/
const cache = new NodeCache({ useClones: false });

/**
   Routes
*/
// ~/ - list all feature keys
router.get('/', (ctx, next) => {
  ctx.body = {
    features: Object.keys(features),
  };
});

// ~/{FEATURE} - list all valid Site Codes for a given Feature
router.get('/:feature', (ctx, next) => {
  if (!Object.keys(features).includes(ctx.params.feature)) {
    ctx.status = 400;
    ctx.body = 'Invalid Feature';
    return;
  }
  ctx.body = {
    siteCodes: features[ctx.params.feature],
  };
});

// ~/{FEATURE}/{SITECODE} - return the corresponding asset JSON
router.get('/:feature/:siteCode', (ctx, next) => {
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
  const assetKey = getAssetKey(ctx.params.feature, ctx.params.siteCode);
  const assetData = cache.get(assetKey);
  if (assetData === undefined) {
    ctx.status = 404;
    ctx.body = 'Feature and Site Code are valid but asset not found';
    return;
  }
  ctx.body = assetData;
});

api.use(router.routes());
api.use(router.allowedMethods());

/**
   Populate Cache
*/
const cachePromises = [];
Object.keys(features).forEach((feature) => {
  features[feature].forEach((siteCode) => {
    const assetKey = getAssetKey(feature, siteCode);
    const assetPath = path.join(ASSETS_PATH, feature, `${siteCode}.json`);
    const promise = fs.promises.readFile(assetPath).then((assetData) => {
      cache.set(assetKey, JSON.parse(assetData));
    });
    cachePromises.push(promise);
  });
});

/**
   Start the API (once cache is populated)
*/
Promise.all(cachePromises).then((assets) => {
  console.log(`${assets.length} Assets read into cache`);
  api.listen(3100);
});
