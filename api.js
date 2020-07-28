const fs = require('fs');
const Koa = require('koa');
const Router = require('koa-router');
const Logger = require('koa-logger');

const api = new Koa();
const router = new Router();
api.use(Logger());

// features.json must exist and be parseable! (generated from build.js)
let features = {};
try {
  const stats = fs.statSync('./features.json');
  features = JSON.parse(fs.readFileSync('./features.json'));
} catch (err) {
  console.error('Unable to start API: features.json missing or malformed. Run build.js to regenrate.');
  process.exit(1);
}

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
  ctx.body = `Feature: ${ctx.params.feature}; Site Code: ${ctx.params.siteCode}`;
});

api.use(router.routes());
api.use(router.allowedMethods());
api.listen(3100);
