import type { Document, Types } from "mongoose";

export interface CartItemDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  productId: Types.ObjectId;
  qty: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddCartItemInput {
  productId: string;
  qty: number;
}

export interface UpdateCartItemInput {
  qty: number;
}
