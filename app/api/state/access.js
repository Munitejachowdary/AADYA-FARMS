export const USER_ROLES = Object.freeze({
  "aadyafarms08@gmail.com": "admin",
  "muniteja@mcsquared.ai": "admin",
  "munitejachowdary@gmail.com": "admin",
  "s.kachavarapu@gmail.com": "admin",
  // Add future approved accounts here with the "operator" role.
});

const OPERATOR_MUTABLE_KEYS = new Set([
  "customers",
  "entries",
  "payments",
  "supplyPauses",
  "farmers",
  "farmerCollections",
  "farmerPayments",
  "invoiceNumbers",
]);

const INDIVIDUALLY_DELETABLE_RECORDS = [
  "entries",
  "payments",
  "supplyPauses",
  "farmerCollections",
  "farmerPayments",
];

export function getRoleForEmail(email) {
  return USER_ROLES[String(email || "").trim().toLowerCase()] || null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function ids(rows) {
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.map(row => row && typeof row === "object" ? String(row.id || "") : "").filter(Boolean));
}

function removedIds(before, after) {
  const nextIds = ids(after);
  return [...ids(before)].filter(id => !nextIds.has(id));
}

export function operatorMutationError(previous, next) {
  if (!previous || typeof previous !== "object") return "An admin must initialize the online ledger before an operator can save records.";
  if (!next || typeof next !== "object") return "Invalid ledger data.";

  const allKeys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of allKeys) {
    if (!OPERATOR_MUTABLE_KEYS.has(key) && !sameValue(previous[key], next[key])) {
      return "Only an admin can change business settings or dashboard configuration.";
    }
  }

  if (removedIds(previous.customers, next.customers).length) {
    return "Operators cannot delete customer profiles.";
  }
  if (removedIds(previous.farmers, next.farmers).length) {
    return "Operators cannot delete farmer profiles.";
  }

  for (const key of INDIVIDUALLY_DELETABLE_RECORDS) {
    if (removedIds(previous[key], next[key]).length > 1) {
      return "Operators can delete only one individual record at a time.";
    }
  }

  return null;
}
