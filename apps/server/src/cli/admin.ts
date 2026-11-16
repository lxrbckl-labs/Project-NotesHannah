import { runAdmin } from "./commands.js";
import { readPassword } from "./prompt.js";

const code = await runAdmin(process.argv.slice(2), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readPassword,
  interactive: process.stdin.isTTY === true,
});
process.exit(code);
