import { Router } from "express";
import * as controller from "./wishlist.controller.js";
import { requireAuth } from "../../shared/auth.js";

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /wishlist:
 *   get:
 *     summary: List the logged-in user's wishlist items (cursor paginated)
 *     tags: [Wishlist]
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
 *       200: { description: Paginated wishlist item list }
 */
router.get("/", controller.list);

/**
 * @openapi
 * /wishlist/{id}:
 *   get:
 *     summary: Get wishlist item by id
 *     tags: [Wishlist]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Wishlist item }
 *       404: { description: Not found }
 */
router.get("/:id", controller.getById);

/**
 * @openapi
 * /wishlist:
 *   post:
 *     summary: Add product to wishlist
 *     tags: [Wishlist]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId: { type: string }
 *     responses:
 *       201: { description: Added }
 *       400: { description: Validation error }
 *       409: { description: Product already in wishlist }
 */
router.post("/", controller.add);

/**
 * @openapi
 * /wishlist/{id}:
 *   delete:
 *     summary: Remove wishlist item
 *     tags: [Wishlist]
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
router.delete("/:id", controller.remove);

export default router;
