import { Router } from "express";
import * as controller from "./users.controller.js";
import { requireAuth } from "../../shared/auth.js";

const router = Router();

/**
 * @openapi
 * /users/signup:
 *   post:
 *     summary: Create a new account and issue tokens
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               gender: { type: string, enum: [male, female, other, prefer_not_to_say] }
 *               bio: { type: string, maxLength: 300 }
 *     responses:
 *       201: { description: Created - returns user + accessToken + refreshToken }
 *       400: { description: Validation error }
 *       409: { description: Email already registered }
 */
router.post("/signup", controller.signup);

/**
 * @openapi
 * /users/login:
 *   post:
 *     summary: Log in and issue tokens
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: OK - returns user + accessToken + refreshToken }
 *       401: { description: Invalid credentials or deactivated account }
 */
router.post("/login", controller.login);

/**
 * @openapi
 * /users/refresh:
 *   post:
 *     summary: Exchange a valid refresh token for a new access token
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200: { description: OK - returns a new accessToken }
 *       400: { description: Validation error }
 *       401: { description: Invalid, expired, or revoked refresh token }
 */
router.post("/refresh", controller.refresh);

// everything below needs a valid access token - order matters, Express only
// applies .use() to routes registered after it in this same router
router.use(requireAuth);

/**
 * @openapi
 * /users/me:
 *   get:
 *     summary: Get the logged-in user's own profile
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *       401: { description: Missing, invalid, or revoked token }
 */
router.get("/me", controller.me);

/**
 * @openapi
 * /users/me:
 *   put:
 *     summary: Update the logged-in user's own profile
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               gender: { type: string, enum: [male, female, other, prefer_not_to_say] }
 *               bio: { type: string, maxLength: 300 }
 *               isActive: { type: boolean, enum: [false], description: Self-deactivate only - kills every session this user has }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Validation error }
 *       401: { description: Missing, invalid, or revoked token }
 */
router.put("/me", controller.updateProfile);

/**
 * @openapi
 * /users/logout:
 *   post:
 *     summary: Revoke the current session (kills this session's access + refresh tokens both)
 *     tags: [Users]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: OK }
 *       401: { description: Missing, invalid, or revoked token }
 */
router.post("/logout", controller.logout);

export default router;
