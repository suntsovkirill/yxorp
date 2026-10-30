// Counts rewrites in the shared store — rewrite scripts get ctx as the 5th argument.
module.exports = (body, proxyRes, req, res, ctx) => {
  const count = (ctx.store.get('rewrites') ?? 0) + 1;
  ctx.store.set('rewrites', count);
  return { count, params: ctx.params };
};
