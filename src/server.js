import { createServer } from "node:http";
import { createRouter } from "./router.js";
import { runMiddlewares } from "./middleware.js";
const router = createRouter();

router.get("/", (req, res) => {
  res.end(JSON.stringify({ message: "Home" }));
});

router.get("/products", (req, res) => {
  res.end(JSON.stringify({
    products: ["Laptop", "Mobile", "Keyboard"],
  }));
});

router.post("/products", (req, res) => {
  res.statusCode = 201;
  res.end(JSON.stringify({
    message: "Product route reached",
  }));
});

router.get("/products/:id", (req, res) => {
  res.end(JSON.stringify({
    productId: req.params.id,
    requestedAt: req.requestTime,
  }));
});


const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    const url = new URL(req.url, "http://localhost");

    const match = router.find(req.method, url.pathname);

    if (!match) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Route not found" }));
    return;
    }

    req.params = match.params;

    const logger = (req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
    };

    const addRequestTime = (req, res, next) => {
    req.requestTime = new Date();
    next();
    };

    runMiddlewares(req, res, [
    logger,
    addRequestTime,
    match.route.handler,
    ]);
});

server.listen(5001, () => {
  console.log("Server running on http://localhost:5001");
});