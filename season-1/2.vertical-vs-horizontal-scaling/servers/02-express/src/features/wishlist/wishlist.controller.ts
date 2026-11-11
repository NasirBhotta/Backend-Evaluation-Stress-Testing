import type { Request, Response } from "express";
import { WishlistItem } from "./wishlist.model.js";
import * as validate from "./wishlist.validation.js";
import { httpError } from "../../shared/error.js";
import { parseLimit, buildCursorFilter, buildNextCursor } from "../../shared/pagination.js";

// Express 5: async handlers ke rejected promises (throw included) khud errorHandler tak forward ho jaate hain

export const list = async (req: Request, res: Response): Promise<void> => {
  const limit = parseLimit(req.query.limit);
  const filter = buildCursorFilter(req.query.cursor);

  const items = await WishlistItem.find({ ...filter, userId: req.user!.id })
    .sort({ _id: 1 })
    .limit(limit)
    .populate("productId")
    .lean();
  res.json({ items, nextCursor: buildNextCursor(items, limit) });
};

export const getById = async (req: Request, res: Response): Promise<void> => {
  const item = await WishlistItem.findOne({ _id: req.params.id, userId: req.user!.id }).populate("productId").lean();
  if (!item) throw httpError(404, "Wishlist item not found");
  res.json(item);
};

export const add = async (req: Request, res: Response): Promise<void> => {
  const payload = validate.validateAdd(req.body);

  try {
    const item = await WishlistItem.create({ ...payload, userId: req.user!.id });
    res.status(201).json(item);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw httpError(409, "Product already in wishlist");
    throw err;
  }
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const item = await WishlistItem.findOneAndDelete({ _id: req.params.id, userId: req.user!.id });
  if (!item) throw httpError(404, "Wishlist item not found");
  res.json({ deleted: item });
};
