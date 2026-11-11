export function runMiddlewares(req, res, middlewares) {
  let index = 0;

  function next() {
    const middleware = middlewares[index];

    index++;

    if (!middleware) {
      return;
    }

    middleware(req, res, next);
  }

  next();
}