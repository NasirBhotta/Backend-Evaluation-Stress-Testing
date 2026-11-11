import mongoose from "mongoose";
import { httpError } from "../../shared/error.js";
import type { AddWishlistItemInput } from "./wishlist.types.js";

// ponytail: haath se likhi validation, yaha type shape simple hai — zod poore app me sirf env ke liye
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export const validateAdd = (body: unknown): AddWishlistItemInput => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(b.productId)) throw httpError(400, "productId (non-empty string) required");
  if (!mongoose.Types.ObjectId.isValid(b.productId)) throw httpError(400, "productId must be a valid ObjectId");

  return { productId: b.productId.trim() };
};
