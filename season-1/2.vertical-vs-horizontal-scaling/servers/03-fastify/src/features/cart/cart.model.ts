import mongoose, { Schema } from "mongoose";
import type { CartItemDocument } from "./cart.types.js";

const cartItemSchema = new Schema<CartItemDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "productId is required"],
    },
    qty: { type: Number, required: [true, "qty is required"], min: 1 },
  },
  { timestamps: true },
);

// ek user ki ek hi cart line per product — dobara add hone pe qty badhti hai
cartItemSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const CartItem = mongoose.model<CartItemDocument>("CartItem", cartItemSchema);
