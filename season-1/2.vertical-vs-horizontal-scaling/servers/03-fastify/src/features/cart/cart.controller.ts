import type { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { CartItem } from "./cart.model.js";
import * as validate from "./cart.validation.js";
import { httpError } from "../../shared/error.js";
import { parseLimit, buildCursorFilter, buildNextCursor } from "../../shared/pagination.js";

const queryOf = (req: FastifyRequest): Record<string, unknown> => req.query as Record<string, unknown>;
const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

export const list = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const query = queryOf(req);
  const limit = parseLimit(query.limit);
  const filter = buildCursorFilter(query.cursor);
  const userId = req.user!.id;

  const items = await CartItem.find({ ...filter, userId }).sort({ _id: 1 }).limit(limit).populate("productId").lean();

  // Whole-cart value, not the current page, so this is a separate aggregation.
  const totalAgg = await CartItem.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $lookup: {
        from: "products",
        localField: "productId",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $group: {
        _id: null,
        total: { $sum: { $multiply: ["$product.price", "$qty"] } },
      },
    },
  ]);
  const total = totalAgg[0]?.total ?? 0;

  await reply.send({ items, nextCursor: buildNextCursor(items, limit), total });
};

export const getById = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const item = await CartItem.findOne({ _id: idOf(req), userId: req.user!.id }).populate("productId").lean();
  if (!item) throw httpError(404, "Cart item not found");
  await reply.send(item);
};

export const add = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const payload = validate.validateAdd(req.body);
  const userId = req.user!.id;

  // status code (200 vs 201) is best-effort under a concurrent race - the $inc
  // upsert below is atomic and always correct regardless of which code we send
  const wasExisting = await CartItem.exists({ userId, productId: payload.productId });

  const item = await CartItem.findOneAndUpdate(
    { userId, productId: payload.productId },
    { $inc: { qty: payload.qty } },
    { upsert: true, new: true },
  );

  await reply.code(wasExisting ? 200 : 201).send(item);
};

export const update = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const patch = validate.validateUpdate(req.body);
  const item = await CartItem.findOneAndUpdate({ _id: idOf(req), userId: req.user!.id }, patch, {
    new: true,
    runValidators: true,
  });
  if (!item) throw httpError(404, "Cart item not found");
  await reply.send(item);
};

export const adjustQuantity = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const delta = validate.validateQuantityDelta(req.body);
  const userId = req.user!.id;
  const id = idOf(req);

  if (delta > 0) {
    const item = await CartItem.findOneAndUpdate({ _id: id, userId }, { $inc: { qty: delta } }, { new: true });
    if (!item) throw httpError(404, "Cart item not found");
    await reply.send(item);
    return;
  }

  // delta < 0: only apply if qty stays >= 1 - qty never goes negative in the DB
  const decremented = await CartItem.findOneAndUpdate(
    { _id: id, userId, qty: { $gt: -delta } },
    { $inc: { qty: delta } },
    { new: true },
  );
  if (decremented) {
    await reply.send(decremented);
    return;
  }

  // guard didn't match: either qty <= |delta| (decrementing removes the line) or it never existed
  const deleted = await CartItem.findOneAndDelete({ _id: id, userId });
  if (!deleted) throw httpError(404, "Cart item not found");
  await reply.send({ deleted });
};

export const remove = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const item = await CartItem.findOneAndDelete({ _id: idOf(req), userId: req.user!.id });
  if (!item) throw httpError(404, "Cart item not found");
  await reply.send({ deleted: item });
};
