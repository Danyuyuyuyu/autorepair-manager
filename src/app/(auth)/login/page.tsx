import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";

import { LoginForm } from "@/features/auth/login-form";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      {/* 品牌区 */}
      <div className="flex flex-col items-center gap-3 px-6 pt-16 pb-8 sm:pt-24">
        <span className="bg-brand text-brand-foreground shadow-raised grid size-16 place-items-center rounded-2xl">
          <Wrench className="size-8" />
        </span>
        <div className="text-center">
          <h1 className="text-foreground text-xl font-semibold">{APP_SHORT_NAME}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{APP_NAME}</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm px-6 pb-12">
        <div className="rounded-card border-border bg-card shadow-card border p-5">
          <LoginForm />
        </div>

        <p className="text-subtle-foreground mt-6 text-center text-xs leading-relaxed">
          数据统一存储在服务器，手机与电脑访问同一套账目。
          <br />
          首次使用请用管理员账号登录后，在「设置」中添加员工账号。
        </p>
      </div>
    </div>
  );
}
