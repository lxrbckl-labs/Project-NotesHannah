import type { User } from "@notes/schema";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { forgetDevices, isKnownDevice, rememberDevice } from "./devices.js";
import { createSession, deleteUserSessions, pruneExpiredSessions } from "./sessions.js";
import { LoginThrottle } from "./throttle.js";
import {
  findUserById,
  findUserByUsername,
  getPasswordHash,
  setPasswordHash,
  toUser,
} from "./users.js";

/** One message for unknown username, wrong password and disabled account. */
export const BAD_CREDENTIALS = "Wrong username or password.";

export interface LoginRequest {
  username: string;
  password: string;
  address: string;
  deviceToken: string | undefined;
  userAgent: string | null;
}

export interface LoginResult {
  user: User;
  sessionToken: string;
  deviceToken: string;
}

function rateLimited(waitMs: number): AppError {
  const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
  return new AppError("rate_limited", "Too many failed sign-in attempts. Wait and try again.", {
    retryAfter,
  });
}

/**
 * Verify a password under the throttle. Counters are bumped before the
 * (slow) hash check in the same synchronous step as the lock check, then
 * cleared on success; see throttle.ts.
 */
async function checkPassword(
  deps: ServerDeps,
  throttle: LoginThrottle,
  req: { username: string; password: string; address: string; deviceKnown: boolean },
  stored: string | undefined,
  now: number,
): Promise<boolean> {
  const addressWait = throttle.waitMs("address", req.address, now);
  const accountWait = req.deviceKnown ? 0 : throttle.waitMs("account", req.username, now);
  const wait = Math.max(addressWait, accountWait);
  if (wait > 0) throw rateLimited(wait);
  throttle.recordFailure("address", req.address, now);
  throttle.recordFailure("account", req.username, now);

  const ok = stored
    ? await deps.hasher.verify(stored, req.password)
    : await deps.hasher.verifyDummy(req.password);
  if (ok) {
    throttle.clear("address", req.address);
    throttle.clear("account", req.username);
  }
  return ok;
}

export async function login(deps: ServerDeps, req: LoginRequest): Promise<LoginResult> {
  const { db } = deps;
  const now = deps.now();
  const throttle = new LoginThrottle(db);
  const user = findUserByUsername(db, req.username);
  const deviceKnown = user ? isKnownDevice(db, user.id, req.deviceToken, now) : false;
  const stored = user ? getPasswordHash(db, user.id) : undefined;

  const ok = await checkPassword(
    deps,
    throttle,
    { username: req.username, password: req.password, address: req.address, deviceKnown },
    stored,
    now,
  );
  // Re-read: the user may have been disabled while the hash was running.
  const current = user ? findUserById(db, user.id) : undefined;
  if (!ok || !current || !stored || current.disabled_at !== null) {
    throw new AppError("unauthenticated", BAD_CREDENTIALS);
  }

  if (deps.hasher.needsRehash(stored)) {
    setPasswordHash(db, current.id, await deps.hasher.hash(req.password), deps.now());
  }
  const done = deps.now();
  pruneExpiredSessions(db, done);
  throttle.prune(done);
  const { token } = createSession(db, current.id, done, req.userAgent);
  const deviceToken = rememberDevice(db, current.id, req.deviceToken, done);
  return { user: toUser(current), sessionToken: token, deviceToken };
}

/**
 * Change the signed-in user's password. A wrong current password counts as a
 * failed sign-in (so a stolen session cannot be used to guess it quickly) and
 * is reported as `invalid_input`, not `unauthenticated`, because the session
 * itself is fine. On success every other session ends and other devices are
 * forgotten.
 */
export async function changePassword(
  deps: ServerDeps,
  req: {
    userId: string;
    sessionId: string;
    currentPassword: string;
    newPassword: string;
    address: string;
    deviceToken: string | undefined;
  },
): Promise<void> {
  const { db } = deps;
  const now = deps.now();
  const user = findUserById(db, req.userId);
  if (!user) throw new AppError("unauthenticated", "Sign in again.");
  const stored = getPasswordHash(db, user.id);
  const ok = await checkPassword(
    deps,
    new LoginThrottle(db),
    {
      username: user.username,
      password: req.currentPassword,
      address: req.address,
      deviceKnown: isKnownDevice(db, user.id, req.deviceToken, now),
    },
    stored,
    now,
  );
  if (!ok) {
    throw new AppError("invalid_input", "The current password is not correct.", {
      hint: "Enter the password you signed in with.",
    });
  }
  const hash = await deps.hasher.hash(req.newPassword);
  const done = deps.now();
  db.transaction(() => {
    setPasswordHash(db, user.id, hash, done);
    deleteUserSessions(db, user.id, req.sessionId);
    forgetDevices(db, user.id, req.deviceToken);
  })();
}

/** Admin password reset: new hash, every session ended, every device forgotten, locks cleared. */
export async function resetPassword(
  deps: Pick<ServerDeps, "db" | "hasher" | "now">,
  userId: string,
  newPassword: string,
): Promise<void> {
  const { db } = deps;
  const user = findUserById(db, userId);
  if (!user) throw new AppError("not_found", "No such user.");
  const hash = await deps.hasher.hash(newPassword);
  db.transaction(() => {
    setPasswordHash(db, user.id, hash, deps.now());
    deleteUserSessions(db, user.id);
    forgetDevices(db, user.id);
    new LoginThrottle(db).clear("account", user.username);
  })();
}
