import { httpError } from "../../shared/error.js";
import { GENDERS } from "./users.types.js";
import type { Gender, LoginInput, SignupInput, UpdateProfileInput } from "./users.types.js";

// ponytail: haath se likhi validation, zod poore app me sirf env ke liye (cart.validation.ts jaisa)
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isValidEmail = (v: unknown): v is string => isNonEmptyString(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isValidPassword = (v: unknown): v is string => typeof v === "string" && v.length >= 8;
const isGender = (v: unknown): v is Gender => typeof v === "string" && (GENDERS as readonly string[]).includes(v);

export const validateSignup = (body: unknown): SignupInput => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(b.name)) throw httpError(400, "name is required");
  if (!isValidEmail(b.email)) throw httpError(400, "a valid email is required");
  if (!isValidPassword(b.password)) throw httpError(400, "password must be at least 8 characters");
  if (b.gender !== undefined && !isGender(b.gender)) {
    throw httpError(400, `gender must be one of: ${GENDERS.join(", ")}`);
  }
  if (b.bio !== undefined && (typeof b.bio !== "string" || b.bio.length > 300)) {
    throw httpError(400, "bio must be a string up to 300 characters");
  }

  return {
    name: b.name.trim(),
    email: b.email.trim().toLowerCase(),
    password: b.password,
    gender: isGender(b.gender) ? b.gender : undefined,
    bio: typeof b.bio === "string" ? b.bio.trim() : undefined,
  };
};

export const validateLogin = (body: unknown): LoginInput => {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isValidEmail(b.email)) throw httpError(400, "a valid email is required");
  if (!isNonEmptyString(b.password)) throw httpError(400, "password is required");

  return { email: b.email.trim().toLowerCase(), password: b.password };
};

export const validateRefresh = (body: unknown): string => {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNonEmptyString(b.refreshToken)) throw httpError(400, "refreshToken is required");
  return b.refreshToken;
};

export const validateUpdateProfile = (body: unknown): UpdateProfileInput => {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: UpdateProfileInput = {};

  if (b.name !== undefined) {
    if (!isNonEmptyString(b.name)) throw httpError(400, "name must be a non-empty string");
    patch.name = b.name.trim();
  }
  if (b.gender !== undefined) {
    if (!isGender(b.gender)) throw httpError(400, `gender must be one of: ${GENDERS.join(", ")}`);
    patch.gender = b.gender;
  }
  if (b.bio !== undefined) {
    if (typeof b.bio !== "string" || b.bio.length > 300) throw httpError(400, "bio must be a string up to 300 characters");
    patch.bio = b.bio.trim();
  }
  if (b.isActive !== undefined) {
    // self-service: a user may only deactivate themselves, never reactivate - that needs an admin path this project doesn't have
    if (b.isActive !== false) throw httpError(400, "isActive can only be set to false (self-deactivate)");
    patch.isActive = false;
  }

  if (Object.keys(patch).length === 0) throw httpError(400, "no updatable fields provided");
  return patch;
};
