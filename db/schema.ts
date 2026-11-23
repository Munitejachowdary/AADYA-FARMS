import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ledgerState = sqliteTable("ledger_state", {
  id: integer("id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});
