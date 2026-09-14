# =============================================================================
# 汽修管家 —— 生产镜像（Next.js standalone 输出）
# 使用 Debian slim 而非 alpine：Prisma 引擎在 musl 环境下需要额外适配
# =============================================================================
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# ---------------------------------------------------------------------------
# 1. 安装依赖
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile || pnpm install

# ---------------------------------------------------------------------------
# 2. 构建
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
ENV BUILD_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma Client 必须在 next build 之前生成
RUN pnpm prisma:generate
# 构建期不需要真实数据库连接（页面全部为动态渲染）
RUN pnpm build

# ---------------------------------------------------------------------------
# 3. 运行时
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema / migrations / 种子脚本用于容器内执行迁移
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs
EXPOSE 3000

# 启动前执行迁移（幂等），再启动服务
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
