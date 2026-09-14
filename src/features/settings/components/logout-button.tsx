"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { logoutAction } from "@/server/actions/auth.actions";

export function LogoutButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        block
        className="text-danger-strong"
        onClick={() => setOpen(true)}
      >
        <LogOut />
        退出登录
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="退出当前账号？"
        description="退出后需要重新输入账号密码登录。"
        confirmText="退出登录"
        tone="danger"
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          try {
            await logoutAction();
            router.push("/login");
            router.refresh();
          } catch {
            setPending(false);
            toast.error("退出失败，请重试。");
          }
        }}
      />
    </>
  );
}
