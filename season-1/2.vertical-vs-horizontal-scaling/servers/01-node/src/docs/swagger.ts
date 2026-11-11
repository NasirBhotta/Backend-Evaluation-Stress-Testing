import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Flipkart API",
      version: "1.0.0",
      description: "Modular ecommerce API — products, cart, wishlist (cursor pagination, max limit 100)",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
  },
  apis: ["./src/features/**/*.router.ts"],
});
