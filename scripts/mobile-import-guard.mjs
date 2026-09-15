import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = process.cwd();
const entries = [
  "src/domain/enums.ts",
  "src/domain/entities.ts",
  "src/domain/rows.ts",
  "src/domain/repositories.ts",
  "src/lib/money.ts",
  "src/lib/plate.ts",
  "src/lib/validation/auth.ts",
  "src/lib/validation/common.ts",
  "src/lib/validation/customer.ts",
  "src/lib/validation/inventory.ts",
  "src/lib/validation/work-order.ts",
];
const forbidden = /^(?:next(?:\/|$)|server-only$|node:|@prisma(?:\/|$)|@\/server(?:\/|$))/;
const visited = new Set();
const failures = [];

function resolveLocal(specifier) {
  const candidate = specifier.startsWith("@/") ? resolve(root, "src", specifier.slice(2)) : null;
  if (!candidate) return null;
  for (const path of [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    resolve(candidate, "index.ts"),
  ]) {
    if (existsSync(path)) return path;
  }
  return null;
}

function scan(path) {
  const absolute = resolve(root, path);
  if (visited.has(absolute)) return;
  visited.add(absolute);
  const source = readFileSync(absolute, "utf8");
  const imports = source.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
  );
  for (const match of imports) {
    const specifier = match[1];
    if (forbidden.test(specifier)) failures.push(`${path} -> ${specifier}`);
    const local = resolveLocal(specifier);
    if (local && [".ts", ".tsx"].includes(extname(local))) scan(local);
  }
}

for (const entry of entries) scan(entry);

if (failures.length > 0) {
  console.error("[FAIL] Mobile 可共享依赖闭包触及 PC-only 模块：");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`[PASS] Mobile shared dependency closure: ${visited.size} files`);
console.log("[PASS] forbidden imports: 0 (next/*, server-only, node:*, @prisma/*, @/server/*)");
