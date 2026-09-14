import type { Metadata } from "next";

import { SettingsView } from "@/features/settings/components/settings-view";
import { requireAdminPage } from "@/server/auth/guard";
import { listAuditLogs } from "@/server/auth/audit";
import { toAuditLog } from "@/server/serializers";
import { listCategories, listServiceItems } from "@/server/services/inventory.service";
import { listEmployees, listUsers } from "@/server/services/user.service";

export const metadata: Metadata = { title: "系统设置" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAdminPage();
  const params = await searchParams;

  const initialTab = typeof params.tab === "string" ? params.tab : "users";

  const [users, employees, serviceItems, categories, auditLogs] = await Promise.all([
    listUsers(),
    listEmployees(false),
    listServiceItems({ limit: 200 }),
    listCategories(),
    listAuditLogs({ take: 60 }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">系统设置</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          账号权限、技师档案、维修项目与操作日志
        </p>
      </div>

      <SettingsView
        users={users}
        employees={employees}
        serviceItems={serviceItems}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        auditLogs={auditLogs.map(toAuditLog)}
        currentUserId={user.id}
        initialTab={initialTab}
      />
    </div>
  );
}
