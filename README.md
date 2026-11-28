# Aadya Farms Milk Ledger

A private, mobile-friendly milk delivery ledger for Aadya Farms. Customer, delivery, payment and invoice data is stored in the shared online database and is available to both permitted sign-ins.

## Main workflows

- Search customers by name or phone.
- Tick delivered customers in the daily list, adjust their default milk quantity, add notes, and attach multiple extra items.
- Add a week, ten days, alternate days, selected dates, or CSV rows in one action.
- Record and delete received payments.
- Generate detailed PDF invoices or print eight compact customer bills per A4 sheet.
- Share an invoice through WhatsApp Business from the phone share sheet.
- Download and restore JSON backups.

## Online synchronization

The app loads the shared ledger from its private backend and saves each change online. It also keeps a browser copy for recovery if the connection drops. On first launch after this upgrade, a browser that already has ledger data uploads it when the backend is empty; a new empty browser does not replace existing data.

The header displays `Saved online · shared` when synchronization succeeds. Changes made on another signed-in device are checked periodically and on reload.

## Access

The ChatGPT-hosted site is restricted by its Sites access list. The standalone
Cloudflare Worker must be protected by Cloudflare Access. In both environments,
the backend additionally accepts only these authenticated emails:

- `aadyafarms08@gmail.com`
- `muniteja@mcsquared.ai`
- `munitejachowdary@gmail.com`
- `s.kachavarapu@gmail.com`

The Cloudflare version validates the signed `Cf-Access-Jwt-Assertion` using the
Access team domain and application audience. Set both non-secret variables in
`wrangler.deploy.jsonc` after creating the Access application:

```json
"vars": {
  "CF_ACCESS_TEAM_DOMAIN": "https://YOUR-TEAM.cloudflareaccess.com",
  "CF_ACCESS_AUD": "YOUR-APPLICATION-AUD-TAG"
}
```

## Cloudflare deployment

Production resources:

- Worker: `aadya-farms-ledger`
- URL: `https://aadya-farms-ledger.aadyafarms08.workers.dev`
- D1 database: `aadya-farms-ledger`

Requirements: Node.js 22 or newer, pnpm, and a Cloudflare account with Workers
and D1 access.

```bash
pnpm install --frozen-lockfile
pnpm exec wrangler login --device
pnpm cloudflare:db:migrate
pnpm cloudflare:deploy
```

Run the database migration only when creating a new empty database. Regular
code updates require only `pnpm cloudflare:deploy`.

Before using the Worker, open Cloudflare **Workers & Pages →
aadya-farms-ledger → Access**, protect **All traffic**, and restrict the policy
to the approved email addresses above. Copy the resulting team domain and AUD
tag into the variables shown above, then deploy once more.

The original ChatGPT-hosted site and its database remain separate. Download a
JSON backup from that site and restore it in the Cloudflare version after Access
is working; deploying this Worker does not delete or move the original records.

## Backup

Use **Settings → Download backup** regularly. Restoring a backup updates both the current browser copy and the shared online ledger.
