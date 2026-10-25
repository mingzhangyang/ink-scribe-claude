# First creation: measurement and guidance

## Scope and interpretation

The funnel measures **observed creations in a page session**, not people. Own text and built-in sample text are separate. Editing text before the first generation remains one creation; editing it after an attempt starts a new one. Retrying unchanged text keeps the creation ID and uses a new attempt ID. A new file starts a new creation. Opening a saved/shared document resets attribution; restoring a draft does not emit a new creation. IDs intentionally do not survive reloads: interrupted/reloaded journeys cannot be joined and this is not a retention/unique-visitor system.

`first` means this browser has not recorded an own-content creation start before, using a local boolean. Samples do not consume that marker. Storage unavailable means unknown (reported as false); clearing storage, private browsing, different devices and concurrent first tabs limit this classification. Do not interpret it as a unique-person count.

- `creation_started`: first nonempty text or completed file import; no keystrokes recorded.
- `generation_started/completed/failed/cancelled`: an explicit AI/local attempt. Completion links `requestId` to the existing API log; failures use allowlisted codes only. Cancelled or superseded requests are separate from failures.
- `note_ready`: first actual completed font/layout fit per attempt, never the API response alone. `layout_failed` reports font/overflow once per category per attempt; a subsequent successful retry can still emit ready.
- `library_save_completed/failed`: actual IndexedDB transaction result (including conflict), not button clicks.
- `export_completed/failed`: rendered image handed to download or successful clipboard write. Download does **not** prove the file was saved on disk.
- `share_completed/cancelled/failed/retry_required`: browser share promise outcome. Gesture expiry requests a second tap; cancellation is not failure. Unsupported file sharing falls back to an export event. Completion does not prove delivery to a recipient.

Async operations capture attribution before awaiting. Loading another document while an export/save finishes cannot attribute the result to the new document. Client result closures and layout state suppress duplicate completions; server `event_id` uniqueness deduplicates repeated delivery.

## Transport and privacy

`shared/creation-events.ts` is the strict shared contract. POST `/api/creation-events` accepts 1–20 events, at most 16 KiB, same-origin browser requests only, with a separate rate-limit key (12 batches/minute under the current binding). Unknown fields, arbitrary error text, malformed IDs and unbounded durations are rejected. No source text, titles, rendered content, filenames, full URLs, stored IPs or persistent visitor IDs. IP is used transiently by existing request rate limiting; infrastructure logs are covered by the privacy policy.

The browser batches for up to five seconds and flushes on background/pagehide. Fetch is bounded by a five-second timeout and has no persistent queue or retry loop. Blocking, offline, tab termination and rate limits can lose events. Statistics never gate creation. Browser Do Not Track suppresses transmission. Mock traffic is accepted without persistence, and previews without D1 do not store events.

Events live in a separate `creation_events` D1 table. Daily cron at **03:17 UTC** removes data older than 30 days (so deletion may occur up to one day later). Existing AI logs and optional Analytics Engine remain unchanged; they provide authoritative server generation metrics when client events are missing. There is no publicly readable analytics endpoint.

## Deploy and report

1. Apply `0005_creation_events.sql` with the existing migration-before-deploy workflow (`npm run db:migrate:remote`). The additive table is safe while the old Worker runs.
2. Deploy the Worker/frontend normally. No additional binding or secret is required. Verify the scheduled trigger is present.
3. Run an own-content journey, check the POST returns 204, and query the table. Exclude synthetic probes when interpreting results.
4. Generate a compact seven-day report with:

```sh
npx wrangler d1 execute ink-scribe --remote --file scripts/creation-report.sql
```

The report returns first/non-first own-content creation counts, attempts, generation, readiness and useful outcomes; failure categories; and successful-AI-attempt median/P95 latency. Cohorts use server receipt time in UTC, and counts are deduplicated by creation. Sample use is excluded. Gaps show observed drop-off, not proof of abandonment. Cross-tab and lost-event limitations apply; examine small-sample counts and feedback before optimizing a percentage.

## First-use UI

The bilingual editor guide distinguishes the initial example, organizing, font/layout preparation, blocked layout and ready states. It opens Compose or the existing Export tab and leaves library saving in the existing LibraryBar. It explains draft versus library versus exported backup without creating a second save mechanism. Guidance disappears after own-content save/export/share success and stays dismissed across reloads/tabs; samples and failures do not dismiss it. Existing retry/local fallback controls and draft conflict protection remain authoritative.

## Validation

Unit tests cover strict fields, duplicate delivery, retention, rate limits, failed persistence, mock exclusion, retry IDs, layout deduplication, async attribution and blocked transport. Browser acceptance covers narrow/wide English own-text generation, actual PNG download, private-text exclusion, reload and a blocked telemetry endpoint with successful local save. Existing suites cover Chinese UI, failed generation, storage conflicts, font recovery and clipboard/share flows. These local browser tests use mock AI and do not certify real model quality or native iOS sharing.

## Weekly email report

The Worker can send a Chinese plain-text summary through Resend every Monday at
**13:17 UTC** (09:17 New York during daylight saving time, 08:17 in winter).
It covers the previous complete UTC Monday–Sunday week, not a rolling seven-day
window. It reports deduplicated own-content creations, generation/readiness/useful
outcomes, first-browser markers, failure event counts and successful AI median/P95.
Percentages use all cohort creations as denominator. Zero activity still produces
an email, with unavailable rates/latency shown explicitly.

Unlike the rolling SQL report above, the weekly funnel freezes both creation
starts and their outcomes to that calendar week. Outcomes after Sunday are not
retroactively included. Failure and latency populations use event receipt time,
so they can include attempts from creations started earlier. Sample events are
excluded. A low observed count is not proof of low traffic or abandonment.

### Enable in production

1. Verify a sending domain in Resend and create a sending API key. Use a sender
   address on that verified domain; a single recipient address is supported.
2. From the repository root, log in once if necessary, then apply **all pending**
   D1 migrations (including `0006_weekly_report_deliveries.sql`):

   ```sh
   npx wrangler login
   npm run db:migrate:remote
   ```

   Local development uses `npm run db:migrate`. Do not execute migrations one by
   one; Wrangler tracks which versions are already applied.
3. Configure these production Worker secrets interactively (do not commit them):

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put WEEKLY_REPORT_FROM
   npx wrangler secret put WEEKLY_REPORT_TO
   ```

4. Set `WEEKLY_REPORT_ENABLED` to `"true"` in the production `vars` of
   `wrangler.jsonc`, then use the normal deployment pipeline. It ships disabled
   so merging code alone cannot accidentally send mail. Previews have neither
   the enable flag nor the production mail credentials/D1 binding. Mock AI also
   disables delivery.
5. Confirm the scheduled triggers include `17 13-23 * * 1`, in addition to the
   unchanged daily event-retention cron `17 3 * * *`.

### Delivery and troubleshooting

Each Monday the first invocation freezes the aggregate message and recipient in
D1. Hourly invocations through 23:17 UTC retry unaccepted messages using the same
payload and Resend idempotency key. This delivery window is under 24 hours, the
provider's documented idempotency retention period:
https://resend.com/docs/dashboard/emails/idempotency-keys

The handler uses actual execution time, so delayed/replayed invocations outside
Monday's window do not resend an old report. An accepted week is skipped.
Concurrent calls and ambiguous timeouts reuse the frozen request. Changing the
recipient midway through retries takes effect the following week; do not delete
or manually modify a pending snapshot. After Monday's window, failures are left
for operator investigation rather than replaying beyond provider deduplication.
There is no automatic backfill for missed weeks.

Inspect delivery status without exposing mail addresses or report contents:

```sh
npx wrangler d1 execute ink-scribe --remote --command "SELECT datetime(period_end / 1000, 'unixepoch') AS week_end_utc, datetime(accepted_at / 1000, 'unixepoch') AS provider_accepted_utc, provider_id FROM weekly_report_deliveries ORDER BY period_end DESC LIMIT 12"
```

A non-null `accepted_at` means the provider accepted the message, **not** inbox
delivery. Check Resend delivery/bounce records if it does not arrive. Missing
configuration and provider failures fail the scheduled invocation in Worker logs;
logs never include credentials, recipients or provider response bodies. If a row
remains unaccepted after Monday, inspect these logs. The existing SQL report can
still be run manually while mail is disabled.

Delivery snapshots retain aggregate statistics and configured sender/recipient
addresses in the operator's D1 database, independent of the 30-day raw-event TTL.
They contain no note content or user identifiers. Resend receives only the mail
addresses and this aggregate report. To stop sending, set the enable flag to
`"false"` and redeploy; historical delivery records are not automatically deleted.
Tests simulate the provider; production activation requires the credentials,
verified sender and recipient above, and a real scheduled delivery check.
