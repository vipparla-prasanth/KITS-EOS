-- 005_payments_attendance

CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
    amount DECIMAL(10,2) NOT NULL,
    reference_id VARCHAR(255) UNIQUE NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_event_id UUID NOT NULL REFERENCES sub_events(id) ON DELETE RESTRICT,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    scanned_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_in_by UUID REFERENCES coordinators(id) ON DELETE SET NULL,
    UNIQUE(sub_event_id, team_id)
);

CREATE INDEX idx_attendance_team_sub_event ON attendance_records(team_id, sub_event_id);
