import mongoose, { Schema } from "mongoose";
import { GENDERS } from "./users.types.js";
import type { UserDocument } from "./users.types.js";

const userSchema = new Schema<UserDocument>(
  {
    name: { type: String, required: [true, "Name is required"], trim: true },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    gender: { type: String, enum: GENDERS },
    bio: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

export const User = mongoose.model<UserDocument>("User", userSchema);
