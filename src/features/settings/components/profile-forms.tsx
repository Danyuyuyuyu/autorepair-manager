"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { changeOwnPasswordAction, updateOwnProfileAction } from "@/server/actions/user.actions";

/** 个人资料 + 修改密码（移动端友好，字段少、按钮大） */
export function ProfileForms({ user }: { user: { name: string } }) {
  const router = useRouter();

  const [name, setName] = React.useState(user.name);
  const [phone, setPhone] = React.useState("");
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [savingPassword, setSavingPassword] = React.useState(false);

  const saveProfile = async () => {
    if (!name.trim()) {
      toast.error("请填写姓名。");
      return;
    }
    setSavingProfile(true);
    const result = await updateOwnProfileAction({
      name: name.trim(),
      phone: phone.trim() || undefined,
    });
    setSavingProfile(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("个人资料已更新");
    router.refresh();
  };

  const savePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致。");
      return;
    }
    setSavingPassword(true);
    const result = await changeOwnPasswordAction({ currentPassword, newPassword, confirmPassword });
    setSavingPassword(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("密码已修改，请重新登录");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    router.push("/login");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">个人资料</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="姓名">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="联系电话">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="选填"
                inputMode="tel"
              />
            </Field>
          </div>
          <Button block loading={savingProfile} onClick={() => void saveProfile()}>
            保存资料
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-foreground text-sm font-semibold">修改登录密码</p>
          <Field label="当前密码" required>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="新密码" required hint="至少 8 位，含字母与数字">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="确认新密码" required>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <Button
            variant="outline"
            block
            loading={savingPassword}
            onClick={() => void savePassword()}
          >
            修改密码
          </Button>
          <p className="text-muted-foreground text-xs">
            修改密码后当前所有设备的登录状态都会被清除，需要用新密码重新登录。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
