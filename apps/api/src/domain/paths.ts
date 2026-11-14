import { existsSync } from "node:fs";
import { join } from "node:path";

export function fixturesRoot(): string {
  const candidates = [
    join(process.cwd(), "fixtures"),
    join(process.cwd(), "../../fixtures"),
    join(__dirname, "../../../../fixtures"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "resident-souvenir-v1.json"))) return c;
  }
  return candidates[1];
}
