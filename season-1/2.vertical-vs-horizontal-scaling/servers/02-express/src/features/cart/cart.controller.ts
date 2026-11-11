import type { Request, Response } from "express";
import mongoose from "mongoose";
import { CartItem } from "./cart.model.js";
import * as validate from "./cart.validation.js";
import { httpError } from "../../shared/error.js";
import { parseLimit, buildCursorFilter, buildNextCursor } from "../../shared/pagination.js";

// Express 5: async handlers ke rejected promises (throw included) khud errorHandler tak forward ho jaate hain

export const list = async (req: Request, res: Response): Promise<void> => {
  const limit = parseLimit(req.query.limit);
  const filter = buildCursorFilter(req.query.cursor);
  const userId = req.user!.id;

  const items = await CartItem.find({ ...filter, userId }).sort({ _id: 1 }).limit(limit).populate("productId").lean();

  // total cart value = poore cart ka sum (page-wise nahi), isliye alag aggregation
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

  res.json({ items, nextCursor: buildNextCursor(items, limit), total });
};

export const getById = async (req: Request, res: Response): Promise<void> => {
  const item = await CartItem.findOne({ _id: req.params.id, userId: req.user!.id }).populate("productId").lean();
  if (!item) throw httpError(404, "Cart item not found");
  res.json(item);
};

export const add = async (req: Request, res: Response): Promise<void> => {
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

  res.status(wasExisting ? 200 : 201).json(item);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const patch = validate.validateUpdate(req.body);
  const item = await CartItem.findOneAndUpdate({ _id: req.params.id, userId: req.user!.id }, patch, {
    new: true,
    runValidators: true,
  });
  if (!item) throw httpError(404, "Cart item not found");
  res.json(item);
};

export const adjustQuantity = async (req: Request, res: Response): Promise<void> => {
  const delta = validate.validateQuantityDelta(req.body);
  const userId = req.user!.id;

  if (delta > 0) {
    const item = await CartItem.findOneAndUpdate({ _id: req.params.id, userId }, { $inc: { qty: delta } }, { new: true });
    if (!item) throw httpError(404, "Cart item not found");
    res.json(item);
    return;
  }

  // delta < 0: only apply if qty stays >= 1 - qty never goes negative in the DB
  const decremented = await CartItem.findOneAndUpdate(
    { _id: req.params.id, userId, qty: { $gt: -delta } },
    { $inc: { qty: delta } },
    { new: true },
  );
  if (decremented) {
    res.json(decremented);
    return;
  }

  // guard didn't match: either qty <= |delta| (decrementing removes the line) or it never existed
  const deleted = await CartItem.findOneAndDelete({ _id: req.params.id, userId });
  if (!deleted) throw httpError(404, "Cart item not found");
  res.json({ deleted });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const item = await CartItem.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
  if (!item) throw httpError(404, "Cart item not found");
  res.json({ deleted: item });
};
