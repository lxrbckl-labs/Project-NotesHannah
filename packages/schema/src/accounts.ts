import { z } from "zod";
import { Timestamp } from "./common.js";
import { ApiKeyId, UserId } from "./ids.js";

export const Username = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Lowercase letters, digits, dot, dash and underscore only");

/** Passwords are only ever accepted as input; they are never part of a stored or returned object. */
export const Password = z.string().min(10).max(256);

export const User = z.object({
  id: UserId,
  username: Username,
  displayName: z.string().min(1).max(80),
  createdAt: Timestamp,
  disabledAt: Timestamp.nullable(),
});
export type User = z.infer<typeof User>;

export const LoginInput = z.object({
  username: Username,
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: Password,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

/** `read` keys can traverse and search; `write` keys can also change things. */
export const ApiKeyScope = z.enum(["read", "write"]);
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

/**
 * An API key as shown in settings. The secret itself is shown once at
 * creation and stored only as a hash.
 */
export const ApiKey = z.object({
  id: ApiKeyId,
  userId: UserId,
  name: z.string().min(1).max(80),
  scope: ApiKeyScope,
  /** First characters of the secret, to tell keys apart in a list. */
  preview: z.string().max(16),
  createdAt: Timestamp,
  lastUsedAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const CreateApiKeyInput = z.object({
  name: z.string().min(1).max(80),
  scope: ApiKeyScope,
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInput>;

export const CreatedApiKey = z.object({
  key: ApiKey,
  /** The full secret. Returned once and never again. */
  secret: z.string(),
});
export type CreatedApiKey = z.infer<typeof CreatedApiKey>;

/** Secrets look like `nh_<scope>_<43 url-safe chars>`. */
export const API_KEY_PATTERN = /^nh_(read|write)_[A-Za-z0-9_-]{43}$/;
