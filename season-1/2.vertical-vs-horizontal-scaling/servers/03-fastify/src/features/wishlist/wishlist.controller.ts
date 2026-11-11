import type { FastifyReply, FastifyRequest } from "fastify";
import { WishlistItem } from "./wishlist.model.js";
import * as validate from "./wishlist.validation.js";
import { httpError } from "../../shared/error.js";
import { parseLimit, buildCursorFilter, buildNextCursor } from "../../shared/pagination.js";

const queryOf = (req: FastifyRequest): Record<string, unknown> => req.query as Record<string, unknown>;
const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

export const list = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const query = queryOf(req);
  const limit = parseLimit(query.limit);
  const filter = buildCursorFilter(query.cursor);

  const items = await WishlistItem.find({ ...filter, userId: req.user!.id })
    .sort({ _id: 1 })
    .limit(limit)
    .populate("productId")
    .lean();
  await reply.send({ items, nextCursor: buildNextCursor(items, limit) });
};

export const getById = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const item = await WishlistItem.findOne({ _id: idOf(req), userId: req.user!.id }).populate("productId").lean();
  if (!item) throw httpError(404, "Wishlist item not found");
  await reply.send(item);
};

export const add = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const payload = validate.validateAdd(req.body);

  try {
    const item = await WishlistItem.create({ ...payload, userId: req.user!.id });
    await reply.code(201).send(item);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw httpError(409, "Product already in wishlist");
    throw err;
  }
};

export const remove = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const item = await WishlistItem.findOneAndDelete({ _id: idOf(req), userId: req.user!.id });
  if (!item) throw httpError(404, "Wishlist item not found");
  await reply.send({ deleted: item });
};
