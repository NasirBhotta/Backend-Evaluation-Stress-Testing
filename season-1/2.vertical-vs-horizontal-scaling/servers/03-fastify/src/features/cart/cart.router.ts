import type { FastifyPluginAsync } from "fastify";
import * as controller from "./cart.controller.js";
import { requireAuth } from "../../shared/auth.js";

const cartRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /**
   * @openapi
   * /cart:
   *   get:
   *     summary: List the logged-in user's cart items (cursor paginated)
   *     tags: [Cart]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: cursor
   *         schema: { type: string }
   *         description: Last _id from the previous page
   *       - in: query
   *         name: limit
   *         schema: { type: integer, maximum: 100, default: 20 }
   *     responses:
   *       200: { description: Paginated cart items with total cart value }
   */
  app.get("/", controller.list);

  /**
   * @openapi
   * /cart/{id}:
   *   get:
   *     summary: Get cart item by id
   *     tags: [Cart]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Cart item }
   *       404: { description: Not found }
   */
  app.get("/:id", controller.getById);

  /**
   * @openapi
   * /cart:
   *   post:
   *     summary: Add item to cart (increments qty if product already in cart)
   *     tags: [Cart]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [productId, qty]
   *             properties:
   *               productId: { type: string }
   *               qty: { type: integer, minimum: 1 }
   *     responses:
   *       201: { description: Created }
   *       200: { description: Existing cart line qty updated }
   *       400: { description: Validation error }
   */
  app.post("/", controller.add);

  /**
   * @openapi
   * /cart/{id}:
   *   put:
   *     summary: Update cart item quantity (absolute set)
   *     tags: [Cart]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [qty]
   *             properties:
   *               qty: { type: integer, minimum: 1 }
   *     responses:
   *       200: { description: Updated }
   *       404: { description: Not found }
   */
  app.put("/:id", controller.update);

  /**
   * @openapi
   * /cart/{id}/quantity:
   *   patch:
   *     summary: Adjust cart item quantity by a signed delta (increment or decrement)
   *     description: Positive delta increments. Negative delta decrements, and removes the line entirely if it would take qty to 0 or below.
   *     tags: [Cart]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [delta]
   *             properties:
   *               delta: { type: integer, description: "Non-zero integer, e.g. 1 or -1" }
   *     responses:
   *       200: { description: Updated (or removed - see response body) }
   *       400: { description: Validation error }
   *       404: { description: Not found }
   */
  app.patch("/:id/quantity", controller.adjustQuantity);

  /**
   * @openapi
   * /cart/{id}:
   *   delete:
   *     summary: Remove cart item
   *     tags: [Cart]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Deleted }
   *       404: { description: Not found }
   */
  app.delete("/:id", controller.remove);
};

export default cartRoutes;
