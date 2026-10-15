import { fileURLToPath } from "node:url";
import { Storyteller } from "../server/storyteller.ts";

const [id, option, ...extra] = process.argv.slice(2);
if (!id || (option && option !== "--force") || extra.length)
  throw new Error("Usage: storyteller.ts <run id> [--force]");
const service = new Storyteller(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
const story = await service.generate(id, option === "--force");
console.log(JSON.stringify({ path: service.path(id), ...story }, null, 2));
