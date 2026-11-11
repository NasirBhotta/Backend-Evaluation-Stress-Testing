import mongoose, { Schema } from "mongoose";
import type { WishlistItemDocument } from "./wishlist.types.js";

const wishlistItemSchema = new Schema<WishlistItemDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product id is required"],
    },
  },
  { timestamps: true },
);

// ek user ek product ek hi baar wishlist kar sakta hai
wishlistItemSchema.index({ userId: 1, productId: 1 }, { unique: true });

export const WishlistItem = mongoose.model<WishlistItemDocument>("WishlistItem", wishlistItemSchema);
