# Account report storage

Signed-in report drafts use the verified Google subject and Cloudflare D1. Guests keep their existing IndexedDB drafts. Google Classroom permissions are not required for reports.

Before deploying this version, apply the additive schema migration:

```powershell
npm run db:remote
npm run deploy
```

For local development use `npm run db:local` before `npm run dev`. The existing `DB`, `AUTH_SITE_ORIGIN`, `GOOGLE_CLIENT_ID` and `AUTH_SESSION_SECRET` configuration is reused. No additional external storage service is required.

The authenticated `/api/auth/reports` endpoint supports GET and POST. Writes require the existing origin and CSRF checks. `X-Report-Account` pins requests to the Google subject that opened the editor; it never grants access to another owner. All SQL includes the session owner.

Reports are split into 128K-character chunks to support images without exceeding D1's per-row limit. An atomic D1 batch checks the account revision before changing any report metadata or chunks. Conflicts preserve the newer server state and leave the current editor available for export. Limits: 100 reports, 16 MiB serialized state per report, 64 MiB per account.

Guest drafts are copied explicitly using “Перенести локальні звіти в акаунт”. Existing IDs are skipped, so retrying a partially completed transfer does not create duplicates. Local originals remain intact. Use JSON export/import to transfer a subsequently edited guest report as a separate account report.

On account changes the page reloads into the new account. Unsaved work is kept in an account-specific local recovery database when possible; sign into that account again and choose “Відновити незбережений звіт” to create a separate restored copy. If recovery cannot be written, the page keeps the existing report for JSON export and pauses autosave. Clearing browser data removes local recovery but does not delete server reports.

Validation: `npm test`, `npm run check:worker`, `npm run test:worker`. The integration suite applies D1 migrations to its isolated local database; it never uses production OAuth or writes the remote database.
