import type { Document, Types } from "mongoose";

export const GENDERS = ["male", "female", "other", "prefer_not_to_say"] as const;
export type Gender = (typeof GENDERS)[number];

export interface UserDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  gender?: Gender;
  bio?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  gender?: Gender;
  bio?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  name?: string;
  gender?: Gender;
  bio?: string;
  isActive?: false; // self-deactivate only - reactivation is out of scope
}
