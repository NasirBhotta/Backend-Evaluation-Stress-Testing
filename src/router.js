function matchPath(pattern, pathname) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params = {};

  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }

    if (expected !== actual) {
      return null;
    }
  }

  return params;
}

export function createRouter() {
  const routes = [];

  function addRoute(method, path, handler) {
    routes.push({
      method,
      path,
      handler,
    });
  }

  return {
    get(path, handler) {
      addRoute("GET", path, handler);
    },

    post(path, handler) {
      addRoute("POST", path, handler);
    },

    find(method, path) {
        for (const route of routes) {
            if (route.method !== method) continue;

            const params = matchPath(route.path, path);

            if (params !== null) {
            return { route, params };
            }
        }

    return null;
    }
  };
}