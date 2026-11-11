# AutoID verification

Tested on the Mac with Node.js 22.14.0, SQLite via `node:sqlite`, and Google Chrome. The automated test runner reported **10 passed, 0 failed** on SQLite and on a temporary TLS-enabled PostgreSQL database.

- **Scoring** · Checked expiry at 31 days, 30 days, on the expiry date and after expiry. Checked service at 501 km, 500 km, 1 km, due and overdue.
- **Accounts and access** · Verified signed-out denial, bad credentials, duplicate registration, cross-origin mutation rejection, owner-scoped vehicles and QR images, and logout.
- **Data validation** · Rejected negative mileage, decreasing mileage, invalid calendar dates and an undersized report.
- **Reminders** · Verified one event per vehicle and condition on repeated dashboard loads, a new expired event after time advances, and persistent read state.
- **QR and reports** · Decoded the generated PNG back to its expected URL. Verified public data minimization, both report types, other-owner denial, replacement and revocation.
- **PDFs and sessions** · Verified private access, validation, replacement, deletion, download after restart, session revocation and single-use recovery. Verified an emergency report still succeeds after the parking quota is reached.
- **Persistence** · Restarted the server and confirmed a registered account, private document, read status and revoked QR survived. Sample sessions received different vehicle tokens.
- **Browser** · Chrome exercised the sample dashboard, score dialog, document renewal, phone-sized PDF selection, upload, download and removal, service completion, sticker image, camera decoding using a simulated camera feed, QR photo decoding, mobile public report, owner inbox and print-only layout. An old link displayed an unavailable screen after replacement. The 390 CSS-pixel mobile layouts showed no horizontal overflow.

A physical phone, Mac camera, printer and live Vercel/Supabase deployment were outside this verification run. Follow the README’s camera and same-Wi-Fi steps for an on-device rehearsal.

## Screenshots

- [Phone-sized PDF upload form](screenshots/pdf-upload-mobile.png)
- [Phone-sized document list with a PDF](screenshots/documents-mobile.png)
- [Desktop dashboard](screenshots/dashboard.png)
- [QR identity and print controls](screenshots/qr-identity.png)
- [Mobile dashboard](screenshots/dashboard-mobile.png)
- [Mobile public report form](screenshots/public-mobile.png)
