import mongoose from "mongoose";
import { httpError } from "../../shared/error.js";
import type { AddCartItemInput, UpdateCartItemInput } from "./cart.types.js";

// ponytail: haath se likhi validation, yaha type shape simple hai — zod poore app me sirf env ke liye
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;

export const validateAdd = (body: unknown): AddCartItemInput => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(b.productId) || !mongoose.Types.ObjectId.isValid(b.productId)) {
    throw httpError(400, "productId (valid product id) required");
  }
  if (!isPositiveInt(b.qty)) throw httpError(400, "qty must be an integer >= 1");

  return {
    productId: b.productId.trim(),
    qty: b.qty,
  };
};

export const validateUpdate = (body: unknown): UpdateCartItemInput => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isPositiveInt(b.qty)) throw httpError(400, "qty must be an integer >= 1");

  return { qty: b.qty };
};

export const validateQuantityDelta = (body: unknown): number => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!Number.isInteger(b.delta) || b.delta === 0) throw httpError(400, "delta must be a non-zero integer");

  return b.delta as number;
};
