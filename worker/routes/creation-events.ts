import { parseCreationEvents } from "../../shared/creation-events.ts";
import type { Env } from "../env.ts";
import { AppError, readJsonBody } from "../http.ts";
import type { RouteContext } from "../router.ts";

export async function handleCreationEvents({ request, env, config }: RouteContext): Promise<Response> {
  const events = parseCreationEvents(await readJsonBody(request, 16_384));
  if (!events) throw new AppError(400, "INVALID_REQUEST", "Invalid creation events.");
  // Mock/preview traffic must never contaminate production counts.
  if (!config.mock && env.DB) {
    const now = Date.now();
    await env.DB.batch(events.map((event) => env.DB!.prepare(
      "INSERT OR IGNORE INTO creation_events (event_id, received_at, creation_id, attempt_id, name, source, is_first, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(event.eventId, now, event.creationId, event.attemptId, event.name, event.source, Number(event.first), JSON.stringify(event))));
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function pruneCreationEvents(env: Env): Promise<void> {
  if (env.DB) await env.DB.prepare("DELETE FROM creation_events WHERE received_at < ?").bind(Date.now() - 30 * 86_400_000).run();
}
