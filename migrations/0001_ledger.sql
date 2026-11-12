-- Metadata only: never add source text, review bodies, or credentials here.
CREATE TABLE requests (
 principal TEXT NOT NULL,
 request_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 input_sha256 TEXT NOT NULL,
 profile TEXT NOT NULL,
 claim TEXT NOT NULL,
 created_at TEXT NOT NULL,
 day TEXT NOT NULL,
 month TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','completed','refused','incomplete','invalid_output','unknown')),
 reserved_microusd INTEGER NOT NULL CHECK(reserved_microusd > 0),
 charged_microusd INTEGER NOT NULL CHECK(charged_microusd >= 0),
 metadata TEXT,
 PRIMARY KEY(principal, request_id)
);
CREATE INDEX requests_day ON requests(day);
CREATE INDEX requests_month ON requests(month);
CREATE INDEX requests_active ON requests(state);
