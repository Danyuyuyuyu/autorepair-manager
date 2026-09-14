/**
 * 弹层动画契约
 * ---------------------------------------------------------------------------
 * 为什么需要它：Radix 的 Presence 在 `data-state=closed` 时会读取元素的
 * `animation-name`，**只要存在动画就等 `animationend` 才卸载内容**。
 * 所以 class 里写了 `animate-[xxx_...]` 却没有对应 `@keyframes xxx` 时，
 * 动画永不结束 → 内容永不卸载 → 弹层/抽屉「关不掉」
 *（✕ / Esc / 点遮罩全部表现为无反应，而 state 其实已经是 closed）。
 *
 * 这类缺陷 typecheck / lint / build / 业务契约**全部发现不了**（2026-09-14 实际发生）：
 * 本项目 `globals.css` 当时只定义了 `sheet-up`，而组件引用了
 * `sheet-down / slide-in-right / slide-out-right / slide-in-left / slide-out-left /
 * fade-in / fade-out` 共 7 个不存在的动画名。
 *
 * 本契约把「引用的动画名」与「CSS 里定义的 keyframes」做双向交叉检查。
 * 运行：pnpm animation:contract
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "src");
const GLOBALS_CSS = join(SRC_DIR, "app", "globals.css");

/** Tailwind 内置动画（不需要自定义 keyframes） */
const TAILWIND_BUILTIN = new Set(["spin", "ping", "pulse", "bounce"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** 去掉 CSS 注释：注释里举例的 animate-[xxx_...] / @keyframes xxx 不应参与比对 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function keyframesDefinedIn(css: string): Set<string> {
  return new Set([...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]!));
}

function animationsReferencedIn(text: string): string[] {
  // 匹配 animate-[name_180ms_ease-in] / animate-[wiggle]
  return [...text.matchAll(/animate-\[([A-Za-z][A-Za-z0-9-]*)[_\]]/g)].map((m) => m[1]!);
}

const css = stripComments(readFileSync(GLOBALS_CSS, "utf8"));
const defined = keyframesDefinedIn(css);
const referenced = new Map<string, Set<string>>();
const files = walk(SRC_DIR).filter((file) => /\.(tsx?|css)$/.test(file));

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const text = file.endsWith(".css") ? stripComments(raw) : raw;
  for (const name of animationsReferencedIn(text)) {
    if (TAILWIND_BUILTIN.has(name)) continue;
    const set = referenced.get(name) ?? new Set<string>();
    set.add(relative(ROOT, file).replace(/\\/g, "/"));
    referenced.set(name, set);
  }
}

const missing = [...referenced.keys()].filter((name) => !defined.has(name)).sort();
const unused = [...defined].filter((name) => !referenced.has(name)).sort();

console.log("引用的自定义动画（" + referenced.size + "）：");
for (const [name, where] of [...referenced.entries()].sort()) {
  const ok = defined.has(name) ? "✓" : "✗ 未定义";
  console.log(`  ${ok}  ${name}  ← ${[...where].join(", ")}`);
}
console.log("已定义的 keyframes（" + defined.size + "）：" + [...defined].sort().join(", "));
if (unused.length > 0) {
  console.log("（提示）已定义但当前未被引用：" + unused.join(", "));
}

if (missing.length > 0) {
  console.error(
    `\n✗ 以下动画被 animate-[...] 引用，但 globals.css 里没有对应的 @keyframes，` +
      `会导致弹层关闭时永不卸载（关不掉）：\n  ${missing.join(", ")}`,
  );
  process.exitCode = 1;
} else {
  console.log("\n动画契约：通过（引用与定义一一对应）");
}
