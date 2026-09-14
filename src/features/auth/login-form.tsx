"use client";

import * as React from "react";
import { useActionState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { loginAction } from "@/server/actions/auth.actions";
import type { ActionResult } from "@/types";

export function LoginForm() {
  const [showPassword, setShowPassword] = React.useState(false);

  const [state, formAction, pending] = useActionState<ActionResult<null> | null, FormData>(
    async (_prev, formData) => loginAction(formData),
    null,
  );

  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage error={error} />

      <Field label="账号" htmlFor="username" required>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="请输入登录账号"
          required
        />
      </Field>

      <Field label="密码" htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="请输入登录密码"
            className="pr-11"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
            className="text-muted-foreground hover:bg-muted absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-lg transition-colors"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <Button type="submit" size="lg" block loading={pending} className="mt-2">
        {!pending ? <LogIn /> : null}
        {pending ? "正在登录…" : "登 录"}
      </Button>
    </form>
  );
}
