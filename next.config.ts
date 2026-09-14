import type { NextConfig } from "next";

/**
 * standalone 输出会生成 .next/standalone（生产镜像只需拷贝它，体积比完整 node_modules 小一个数量级）。
 *
 * 但它需要在「Collecting build traces」阶段创建符号链接，而 Windows 默认不允许
 * （需要开发者模式或管理员权限），会直接让构建以 EPERM 失败。
 * 因此改为按需开启：Docker 构建时设置 BUILD_STANDALONE=1，本机开发默认关闭。
 */
const enableStandalone = process.env.BUILD_STANDALONE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(enableStandalone ? { output: "standalone" as const } : {}),
  experimental: {
    // 服务端 Action 中处理表单，放宽默认体积限制（工单项可能较多）
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
