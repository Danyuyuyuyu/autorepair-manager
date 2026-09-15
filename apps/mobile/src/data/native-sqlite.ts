import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

/**
 * 插件的 connection registry 属于进程全局状态；所有业务库、探针库和 contract 库
 * 必须共享同一个 JS connection manager，避免一致性检查误删其他实例的连接。
 */
export const mobileSqlite = new SQLiteConnection(CapacitorSQLite);
