import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../../../db";
import { ledgerState } from "../../../db/schema";
import { getRoleForEmail, operatorMutationError } from "./access.js";

type UserRole = "admin" | "operator";

async function currentUser() {
  const h = await headers();
  const id = h.get("oai-authenticated-user-id");
  const email = h.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? "";
  const role = getRoleForEmail(email) as UserRole | null;
  return id && role ? { id, email, role } : null;
}

function validLedger(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const arrays = ["customers", "entries", "payments", "supplyPauses", "farmers", "farmerCollections", "farmerPayments"];
  return arrays.every(key => Array.isArray(row[key])) && !!row.settings && typeof row.settings === "object" && !!row.invoiceNumbers && typeof row.invoiceNumbers === "object";
}

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in with an allowed account." }, { status: 401 });
  try {
    const [record] = await getDb().select().from(ledgerState).where(eq(ledgerState.id, 1)).limit(1);
    if (!record) return Response.json({ state: null, revision: 0, user: user.email, role: user.role });
    return Response.json({ state: JSON.parse(record.data), revision: record.revision, updatedAt: record.updatedAt, updatedBy: record.updatedBy, user: user.email, role: user.role });
  } catch (error) {
    console.error("ledger GET failed", error);
    return Response.json({ error: "The online ledger is temporarily unavailable." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in with an allowed account." }, { status: 401 });
  try {
    const payload = await request.json() as { state?: unknown };
    if (!validLedger(payload.state)) return Response.json({ error: "Invalid ledger data." }, { status: 400 });
    const [existing] = await getDb().select().from(ledgerState).where(eq(ledgerState.id, 1)).limit(1);
    if (user.role === "operator") {
      const previous = existing ? JSON.parse(existing.data) as Record<string, unknown> : null;
      const denied = operatorMutationError(previous, payload.state);
      if (denied) return Response.json({ error: denied, role: user.role }, { status: 403 });
    }
    const encoded = JSON.stringify(payload.state);
    if (encoded.length > 4_000_000) return Response.json({ error: "The ledger is too large to save." }, { status: 413 });
    const now = new Date().toISOString();
    await getDb().insert(ledgerState).values({ id: 1, data: encoded, revision: 1, updatedAt: now, updatedBy: user.email })
      .onConflictDoUpdate({ target: ledgerState.id, set: { data: encoded, revision: sql`${ledgerState.revision} + 1`, updatedAt: now, updatedBy: user.email } });
    const [saved] = await getDb().select({ revision: ledgerState.revision }).from(ledgerState).where(eq(ledgerState.id, 1)).limit(1);
    return Response.json({ ok: true, revision: saved?.revision ?? 1, updatedAt: now, updatedBy: user.email, role: user.role });
  } catch (error) {
    console.error("ledger PUT failed", error);
    return Response.json({ error: "Could not save the online ledger. Your local copy is still safe." }, { status: 503 });
  }
}
