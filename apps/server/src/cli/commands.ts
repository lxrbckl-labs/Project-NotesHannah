import { Password } from "@notes/schema";
import { type Config, ConfigError, loadConfig } from "../config.js";
import { type Db, migrate, openDatabase } from "../db/client.js";
import { PasswordHasher } from "../domains/accounts/passwords.js";
import { resetPassword } from "../domains/accounts/service.js";
import {
  findUserByUsername,
  insertUser,
  listUsers,
  normaliseUsername,
  setUserDisabled,
  type UserRow,
} from "../domains/accounts/users.js";
import { AppError } from "../http/errors.js";
import { bindStorage } from "../storage/binding.js";
import { initStorage, openStorage, type Storage } from "../storage/storage.js";
import { generatePassword } from "./prompt.js";

export const USAGE = `Usage: admin <command> [options]

Commands:
  init-storage [--create-dir] [--force]   Write the storage marker and layout in DATA_DIR
  create-user <username> [--name "Name"] [--generate]
                                          Create an account (prompts for the password,
                                          or --generate prints a strong one once)
  reset-password <username> [--generate]  Set a new password; ends all sessions
  list-users                              List accounts
  disable-user <username>                 Block sign-in; ends sessions, keys stop working
  enable-user <username>                  Undo disable-user

Environment: DATA_DIR, DB_PATH (see .env.example).`;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Ask for a new password; `confirm` is true when it should be typed twice. */
  readPassword: (prompt: string) => Promise<string>;
  /** Whether a second, confirming prompt is possible (a terminal). */
  interactive: boolean;
  env?: Record<string, string | undefined>;
  hasher?: PasswordHasher;
  now?: () => number;
}

interface Parsed {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(["--name"]);

export function parseArgs(argv: string[]): Parsed {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) flags.set(arg.slice(0, eq), arg.slice(eq + 1));
      else if (VALUE_FLAGS.has(arg)) {
        const value = rest[++i];
        if (value === undefined) throw new AppError("invalid_input", `${arg} needs a value.`);
        flags.set(arg, value);
      } else flags.set(arg, true);
    } else positional.push(arg);
  }
  return { command, positional, flags };
}

function context(io: CliIo): { config: Config; db: Db; storage: Storage; now: () => number } {
  const config = loadConfig(io.env ?? process.env);
  const storage = openStorage(config.DATA_DIR);
  const db = openDatabase(config.DB_PATH);
  migrate(db);
  bindStorage(db, storage);
  return { config, db, storage, now: io.now ?? Date.now };
}

function requireUser(db: Db, raw: string | undefined): UserRow {
  if (!raw) throw new AppError("invalid_input", "Give a username.");
  const user = findUserByUsername(db, normaliseUsername(raw));
  if (!user) throw new AppError("not_found", `No user named ${normaliseUsername(raw)}.`);
  return user;
}

async function obtainPassword(
  io: CliIo,
  generate: boolean,
): Promise<{ password: string; generated: boolean }> {
  if (generate) return { password: generatePassword(), generated: true };
  const password = await io.readPassword("New password: ");
  const valid = Password.safeParse(password);
  if (!valid.success) {
    throw new AppError("invalid_input", "The password must be 10 to 256 characters.");
  }
  if (io.interactive) {
    const again = await io.readPassword("Repeat password: ");
    if (again !== password) throw new AppError("invalid_input", "The passwords do not match.");
  }
  return { password, generated: false };
}

function describe(user: UserRow): string {
  const state =
    user.disabled_at === null ? "active" : `disabled ${new Date(user.disabled_at).toISOString()}`;
  return `${user.username}\t${user.display_name}\t${user.id}\t${new Date(user.created_at).toISOString()}\t${state}`;
}

/** Run one admin command. Returns the process exit code. */
export async function runAdmin(argv: string[], io: CliIo): Promise<number> {
  let db: Db | undefined;
  try {
    const { command, positional, flags } = parseArgs(argv);
    switch (command) {
      case "init-storage": {
        const config = loadConfig(io.env ?? process.env);
        const result = initStorage(config.DATA_DIR, {
          createDir: flags.has("--create-dir"),
          force: flags.has("--force"),
          ...(io.now ? { now: io.now } : {}),
        });
        io.out(
          result.status === "created"
            ? `Initialised storage at ${result.storage.root} (id ${result.storage.marker.storageId}).`
            : `Storage at ${result.storage.root} is already initialised (id ${result.storage.marker.storageId}); nothing changed.`,
        );
        return 0;
      }
      case "create-user": {
        const ctx = context(io);
        db = ctx.db;
        const username = positional[0];
        if (!username) throw new AppError("invalid_input", "Give a username.");
        const name = flags.get("--name");
        if (findUserByUsername(db, normaliseUsername(username))) {
          throw new AppError("conflict", `User ${normaliseUsername(username)} already exists.`);
        }
        const { password, generated } = await obtainPassword(io, flags.has("--generate"));
        const hasher = io.hasher ?? new PasswordHasher();
        const user = insertUser(
          db,
          {
            username,
            displayName: typeof name === "string" ? name : username,
            passwordHash: await hasher.hash(password),
          },
          ctx.now(),
        );
        io.out(`Created ${user.username} (${user.id}).`);
        if (generated) io.out(`Password (shown once): ${password}`);
        return 0;
      }
      case "reset-password": {
        const ctx = context(io);
        db = ctx.db;
        const user = requireUser(db, positional[0]);
        const { password, generated } = await obtainPassword(io, flags.has("--generate"));
        await resetPassword(
          { db, hasher: io.hasher ?? new PasswordHasher(), now: ctx.now },
          user.id,
          password,
        );
        io.out(`Password reset for ${user.username}; all of their sessions have ended.`);
        if (generated) io.out(`Password (shown once): ${password}`);
        return 0;
      }
      case "list-users": {
        const ctx = context(io);
        db = ctx.db;
        const users = listUsers(db);
        if (users.length === 0) io.out("No users.");
        for (const user of users) io.out(describe(user));
        return 0;
      }
      case "disable-user":
      case "enable-user": {
        const ctx = context(io);
        db = ctx.db;
        const user = requireUser(db, positional[0]);
        const disable = command === "disable-user";
        setUserDisabled(db, user.id, disable, ctx.now());
        io.out(
          disable
            ? `Disabled ${user.username}: sessions ended, API keys refused.`
            : `Enabled ${user.username}.`,
        );
        return 0;
      }
      case undefined:
      case "help":
      case "--help":
        io.out(USAGE);
        return command === undefined ? 1 : 0;
      default:
        io.err(`Unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (error) {
    if (error instanceof AppError) {
      io.err(`${error.code}: ${error.message}`);
      if (error.hint) io.err(error.hint);
      return 1;
    }
    if (error instanceof ConfigError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  } finally {
    db?.close();
  }
}
