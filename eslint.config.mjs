import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // 构建产物可能被临时改名（.next.bak / .next.broken），一律不参与 lint
      ".next*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ".devdb/**",
      // 改造前的基线快照（只用于人工比对与回滚，不参与 lint）
      ".baseline/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    // CLI 脚本（种子数据、图标生成、本地数据库）的职责就是向终端输出进度，
    // 这里的 console 是产品行为而不是调试残留，因此豁免该规则。
    files: ["scripts/**/*.{js,mjs,ts}", "prisma/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
