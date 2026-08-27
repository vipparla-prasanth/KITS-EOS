-- 002_events

CREATE TYPE event_status AS ENUM ('ACTIVE', 'ARCHIVED', 'PERMANENTLY_DELETED');
CREATE TYPE participation_type AS ENUM ('SOLO', 'TEAM', 'BOTH');

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    banner_path VARCHAR(1024),
    status event_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    status event_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sub_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rules TEXT,
    banner_path VARCHAR(1024),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    venue VARCHAR(255),
    participation_type participation_type NOT NULL,
    max_team_size INTEGER NOT NULL CHECK (max_team_size >= 1),
    fee_amount_solo DECIMAL(10,2) NOT NULL DEFAULT 0,
    fee_amount_team DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_instructions TEXT,
    required_documents JSONB DEFAULT '[]'::jsonb,
    attendance_token_prefix VARCHAR(10),
    results_locked BOOLEAN NOT NULL DEFAULT false,
    status event_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
