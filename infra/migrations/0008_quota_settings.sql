-- One live row. Env values are the fallback until the owner saves from admin.

CREATE TABLE quota_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  turns_per_day integer NOT NULL CHECK (turns_per_day >= 0),
  voice_minutes_per_day double precision NOT NULL CHECK (voice_minutes_per_day >= 0),
  timezone text NOT NULL,
  warn_ratio double precision NOT NULL CHECK (warn_ratio >= 0 AND warn_ratio <= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL
);
