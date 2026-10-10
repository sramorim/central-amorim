CREATE TABLE IF NOT EXISTS link_clicks (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'project',
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_day ON link_clicks(day);
CREATE INDEX IF NOT EXISTS idx_clicks_target ON link_clicks(target);
