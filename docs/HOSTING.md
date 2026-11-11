# Put AutoID online with Vercel and Supabase

Once deployed, visitors can open the HTTPS site even when your Mac is off. Vercel runs the AutoID pages and API on demand. Supabase PostgreSQL keeps your accounts, PDFs, vehicle records, service history, sessions and inbox. AutoID handles sign-in and document access on the server.

## 1. Create a Supabase database

1. Sign in to [Supabase](https://supabase.com/dashboard) and create a **new project** for AutoID. Save the database password in your password manager. Use a separate project because AutoID installs its own tables.
2. Open **SQL Editor → New query**. Copy all of [supabase/schema.sql](../supabase/schema.sql) into the editor and click **Run**. This creates the required tables and denies direct table access to the browser-facing database roles.
3. Click **Connect** and select **Transaction pooler**. Copy the PostgreSQL URI using port **6543**. Insert the database password where indicated. If it contains reserved URL characters, percent-encode the password portion. Keep the full URI private. This is the server-only `DATABASE_URL`. [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)

## 2. Import the GitHub repo into Vercel

1. Upload the **contents of the AutoID folder** to GitHub using the [README’s GitHub steps](../README.md#upload-the-source-to-github). Make sure `vercel.json`, `api/` and `supabase/` are included.
2. In Vercel, choose **Add New → Project** and import that repository. Choose **Other** for Framework Preset. Leave the root at the folder containing `package.json` and `vercel.json`. Select **Node.js 22.x** in the project settings.
3. Under **Environment Variables**, set `DATABASE_URL` for **Production** to the transaction pooler URI. Do not put the URI in GitHub, browser JavaScript, or a variable starting with `NEXT_PUBLIC_`.
4. Deploy. AutoID uses Vercel’s production URL when available. For an explicit or custom domain, set `PUBLIC_ORIGIN` to your exact HTTPS address, for example `https://autoid-example.vercel.app`, with no path, then redeploy. Always use that address when signing in or printing stickers. Avoid connecting preview deployments to the same live database. [Vercel environment variables](https://vercel.com/docs/environment-variables)

## 3. Audit the hosted site

1. Open the production address and create your owner account. The hosted build starts with an empty database and the local sample button is disabled.
2. Register a sample vehicle. On your phone, sign in and upload a sample PDF through **Documents → Add or upload**. Select its document type. Sign out and back in, then download it and check its expiry.
3. In a second account or signed-out browser, try the owner's PDF download URL. Access should be denied. Scan the vehicle’s public QR and send a sample report. The owner should see it in Inbox.
4. Replace the QR and confirm the old URL stops working. Turn off your Mac or disconnect it from Wi-Fi. On your phone, check that the public profile still opens.
5. Use the dashboard shield to save a recovery code privately. If testing recovery, use a sample account and generate a fresh code after the test.

## Availability, storage and backup

- Vercel Hobby can suit a personal, non-commercial college project within its limits. Supabase Free may pause a low-activity project after about a week. The hosted app is independent of your Mac, but free-tier availability depends on those services. [Vercel Hobby](https://vercel.com/docs/plans/hobby) · [Supabase free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- AutoID limits each attachment to **2 MB**. PDFs are stored in PostgreSQL alongside the rest of the app data, so they count against the database quota. Use sample files for a public demonstration. This version keeps one current PDF per category and does not perform malware scanning or document verification.
- For a hosted backup, export the full AutoID database with PostgreSQL backup tooling over a direct or session-mode connection and save the dump privately. A full database backup includes the PDF bytes. Test restoration in a separate database before relying on the backup. For local SQLite, stop the app and copy the entire `data/` directory. Never publish either backup. [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- Hosted data starts fresh. Copying your SQLite file to GitHub or Vercel will not migrate it. If you have existing local records, keep the local database and re-enter the records you want online.
- Alerts stay in-app. The open inbox refreshes periodically, and expiry reminders are evaluated when the dashboard loads. This setup does not dispatch emergency services or send background email, SMS, or push notifications.
