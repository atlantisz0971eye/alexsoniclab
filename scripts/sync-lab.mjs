// Copies the Lab from the portfolio repository, where it is developed, into this site.
// Usage: npm run sync-lab -- [path to the portfolio checkout]   (default: ../alex-portfolio-starter)
// The copies are kept byte for byte; change the Lab in the portfolio, then sync.
import { copyFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const SHARED = [
  "app/lib/scanPage.ts",
  "app/lib/sonicSignals.ts",
  "app/lib/sonicPlayers.ts",
  "app/lib/sonicSynth.ts",
  "app/lib/sonicPerformance.ts",
  "app/lib/labSettings.ts",
  "app/data/sonicStyles.ts",
  "app/components/SonicLab.tsx",
  "app/components/SonicDeck.tsx",
  "app/components/sonicLab.css",
  "app/utils/environment.ts",
];

const from = resolve(process.argv[2] ?? "../alex-portfolio-starter");
const to = resolve(".");
let changed = 0;
for (const file of SHARED) {
  const source = resolve(from, file);
  if (!existsSync(source)) throw new Error(`Missing in the portfolio: ${source}`);
  const target = resolve(to, file);
  const before = existsSync(target) ? readFileSync(target, "utf8") : null;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (before !== readFileSync(target, "utf8")) {
    changed += 1;
    console.log(`updated ${file}`);
  }
}
console.log(changed ? `${changed} file(s) synced from ${from}` : `Lab already matches ${from}`);
