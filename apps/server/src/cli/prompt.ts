import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

/** A strong generated password: 20 URL-safe characters (120 random bits). */
export function generatePassword(): string {
  return randomBytes(15).toString("base64url");
}

/**
 * Read a password. On a terminal the input is not echoed; otherwise (piped
 * input, e.g. `docker exec -i`) the first line of stdin is read.
 */
export function readPassword(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    return new Promise((resolve, reject) => {
      const rl = createInterface({ input, terminal: false });
      let done = false;
      rl.once("line", (line) => {
        done = true;
        rl.close();
        resolve(line);
      });
      rl.once("close", () => {
        if (!done) reject(new Error("No password on standard input."));
      });
    });
  }
  return new Promise((resolve) => {
    process.stderr.write(question);
    let value = "";
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          input.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    input.on("data", onData);
  });
}
