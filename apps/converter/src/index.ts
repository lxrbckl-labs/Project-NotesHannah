// PLACEHOLDER: the real conversion worker comes later (work package W7).
export function main(): string {
  const message = "converter: placeholder worker, nothing to do";
  console.log(message);
  return message;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
  process.exit(0);
}
