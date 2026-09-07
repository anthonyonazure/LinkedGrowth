-- The analytics this instance collects about itself, stored here rather than
-- sent to anyone. One row per event from the tracker in src/app/layout.tsx.
--
-- No IP address and no user agent column, deliberately. The tracker sends
-- neither, and a column invites somebody to start filling it.
CREATE TABLE IF NOT EXISTS insight_events (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  type TEXT NOT NULL,
  visitor_id TEXT,
  path TEXT NOT NULL,
  referrer TEXT,
  lang TEXT,
  screen_width INTEGER,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  duration_ms INTEGER,
  goal TEXT,
  click_target TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS insight_events_created_at ON insight_events (created_at);
CREATE INDEX IF NOT EXISTS insight_events_site_type ON insight_events (site, type);
