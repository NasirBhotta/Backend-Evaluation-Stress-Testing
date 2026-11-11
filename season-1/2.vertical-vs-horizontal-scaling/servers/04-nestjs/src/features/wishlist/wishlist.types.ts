import type { Document, Types } from "mongoose";

export interface WishlistItemDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  productId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddWishlistItemInput {
  productId: string;
}
