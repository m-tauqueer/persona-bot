-- Voice turn telemetry: reframe time-to-first-token, the transport's own
-- latency breakdown, and an explicit end for a call.

ALTER TABLE latency_spans
  ADD COLUMN reframe_first_token_ms integer,
  ADD COLUMN transport_latency jsonb;

CREATE INDEX latency_spans_awaiting_transport_idx
  ON latency_spans (turn_id)
  WHERE transport_latency IS NULL;
