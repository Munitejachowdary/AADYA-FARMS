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

The site is restricted by its Sites access list. The backend additionally accepts only these authenticated emails:

- `muniteja@mcsquared.ai`
- `munitejachowdary@gmail.com`

## Backup

Use **Settings → Download backup** regularly. Restoring a backup updates both the current browser copy and the shared online ledger.
