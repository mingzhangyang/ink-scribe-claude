-- Cloudflare Email has no documented idempotency key. Claim before calling send;
-- ambiguous outcomes remain claimed until an operator reconciles Email activity.
ALTER TABLE weekly_report_deliveries ADD COLUMN attempted_at INTEGER;
