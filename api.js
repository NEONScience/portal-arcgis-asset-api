const Koa = require('koa');
const Router = require('koa-router');
const Logger = require('koa-logger');

const api = new Koa();
const router = new Router();
api.use(Logger());

const FEATURES = [
  'TOWER_AIRSHEDS',
  'AQUATIC_REACHES',
  'FLIGHT_BOX_BOUNDARIES',
  'SAMPLING_BOUNDARIES',
  'WATERSHED_BOUNDARIES',
  'DRAINAGE_LINES',
  'POUR_POINTS',
];

router.get('/:feature/:siteCode', (ctx, next) => {
  if (!FEATURES.includes(ctx.params.feature)) {
    ctx.status = 400;
    ctx.body = 'Invalid Feature';
    return;
  }
  ctx.body = `Feature: ${ctx.params.feature}; Site Code: ${ctx.params.siteCode}`;
});

api.use(router.routes());
api.use(router.allowedMethods());
api.listen(3100);
