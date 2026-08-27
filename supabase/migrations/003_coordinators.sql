-- 003_coordinators

CREATE TABLE coordinators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    contact_visible BOOLEAN NOT NULL DEFAULT true,
    phone_number VARCHAR(20),
    status user_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE coordinator_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coordinator_id UUID NOT NULL REFERENCES coordinators(id) ON DELETE CASCADE,
    sub_event_id UUID NOT NULL REFERENCES sub_events(id) ON DELETE CASCADE,
    UNIQUE(coordinator_id, sub_event_id)
);
