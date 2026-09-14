import { z } from "zod";

/**
 * 环境变量校验
 * 采用惰性求值：在真正调用 getEnv() 时才校验，
 * 避免 `next build` 阶段因缺少运行时变量而中断。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL 未配置"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET 至少 16 位"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    SESSION_TTL_DAYS: process.env.SESSION_TTL_DAYS,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`环境变量配置错误 -> ${detail}`);
  }

  cached = parsed.data;
  return cached;
}

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "汽车维修店管理系统";
export const APP_SHORT_NAME = process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? "汽修管家";
