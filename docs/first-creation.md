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

The Worker sends a Chinese plain-text report through the native **Cloudflare
Email Service** `WEEKLY_REPORT_EMAIL` binding. No third-party mail API or API key
is needed. The first scheduled attempt is Monday **13:17 UTC** (09:17 New York
in summer, 08:17 in winter); hourly invocations through 23:17 provide a bounded
retry window for explicit quota rejections.

Reports cover the previous complete UTC Monday–Sunday week. They include
own-content creations, generation/readiness/useful outcomes, browser-first
markers, failure counts and successful AI median/P95. Zero activity still sends
a report with unavailable rates/latency shown explicitly. Percentages use cohort
creations as denominator, not attempts or unique users.

Unlike the rolling SQL report above, the weekly funnel freezes both creation
starts and their outcomes to that calendar week. Outcomes after Sunday are not
retroactively included. Failures and latency use event receipt time and can
include attempts from earlier creations. Samples are excluded. Low counts can
reflect missing telemetry and are not proof of abandonment.

### Enable in production

1. Onboard `orangely.xyz` to Cloudflare Email Service and verify
   `admin@orangely.xyz` as a destination address in the account. The checked-in
   binding restricts delivery to this address using `destination_address`.
   See the official [sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
   and [binding configuration](https://developers.cloudflare.com/email-service/configuration/send-bindings/).
2. Log in once if necessary and apply **all pending migrations**, including 0006
   (report snapshot) and 0007 (atomic sending claim):

   ```sh
   npx wrangler login
   npm run db:migrate:remote
   ```

   Use `npm run db:migrate` for local development. Wrangler tracks applied versions;
   do not run SQL files individually. 0007 is additive for databases that already
   applied 0006.
3. Both sender and recipient are preconfigured as `admin@orangely.xyz` in the
   production `vars` of `wrangler.jsonc`; no mail-address secrets are needed.
   If changing the recipient later, also update the binding's `destination_address`.

4. Set production `WEEKLY_REPORT_ENABLED` to `"true"` in `wrangler.jsonc` and deploy
   through the normal pipeline. Ships disabled. The production `send_email`
   binding is already declared; previews have no email binding/enable flag and
   mock mode also prevents sending. No real delivery is attempted by tests.
5. Confirm both crons: `17 13-23 * * 1` for reports and `17 3 * * *` for event cleanup.

### Delivery safety and troubleshooting

The first invocation freezes the report and recipient in D1. An atomic update
claims that week before calling `WEEKLY_REPORT_EMAIL.send()`, so concurrent
invocations cannot send duplicate messages. Successful responses store Cloudflare's
`messageId` and acceptance time. These confirm service acceptance, not inbox delivery.

Cloudflare's documented binding has no idempotency-key parameter. Only explicit
`E_RATE_LIMIT_EXCEEDED` / `E_DAILY_LIMIT_EXCEEDED` rejections release the claim for
a later hourly retry. Unknown errors, worker termination, malformed responses or
failure to persist acceptance keep the claim. This favors avoiding duplicates:
a crash between claiming and sending may result in no mail. Such weeks require
operator reconciliation rather than a blind automatic retry. There is no backfill
outside Monday's window; the handler uses actual execution time for delayed jobs.

Inspect records without printing addresses or report contents:

```sh
npx wrangler d1 execute ink-scribe --remote --command "SELECT datetime(period_end / 1000, 'unixepoch') AS week_end_utc, datetime(attempted_at / 1000, 'unixepoch') AS claimed_utc, datetime(accepted_at / 1000, 'unixepoch') AS accepted_utc, provider_id FROM weekly_report_deliveries ORDER BY period_end DESC LIMIT 12"
```

If `attempted_at` is set but `accepted_at` is null, inspect Cloudflare Email
activity before taking action. If accepted, reconcile the record with its real
message ID; only after confirming **no acceptance and no invocation still in
flight** may an operator clear that week's claim for another Monday-window retry.
Do not delete snapshots to resend. Changes to recipients take effect next week
because an existing snapshot stays frozen. Check Email activity/bounces for a
missing message even when acceptance is recorded. Scheduled failures are visible
in Worker logs; provider messages and mail addresses are not logged by the handler.

Snapshots retain aggregate reports and configured mail addresses separately from
the 30-day raw-event retention. They contain no note contents or user identities.
Set the enable flag to `"false"` and redeploy to stop mail; historical records
remain. Production activation still requires a verified domain/destination and
an actual scheduled-delivery check; mocked binding tests are not delivery proof.
