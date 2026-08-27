-- 004_registrations_teams

CREATE TYPE registration_status AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_event_id UUID NOT NULL REFERENCES sub_events(id) ON DELETE RESTRICT,
    leader_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status registration_status NOT NULL DEFAULT 'PENDING_PAYMENT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure a leader can't register for the same sub_event twice unless cancelled
CREATE UNIQUE INDEX idx_registrations_sub_event_leader ON registrations (sub_event_id, leader_id) WHERE status != 'CANCELLED';

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID UNIQUE NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
    team_name VARCHAR(255)
);

CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_leader BOOLEAN NOT NULL DEFAULT false,
    qr_identity UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    manual_token VARCHAR(10) UNIQUE NOT NULL,
    snapshot_name VARCHAR(255) NOT NULL,
    snapshot_roll_number VARCHAR(50) NOT NULL,
    snapshot_college VARCHAR(255) NOT NULL,
    snapshot_department VARCHAR(255) NOT NULL,
    snapshot_year INTEGER NOT NULL CHECK (snapshot_year >= 1)
);

-- Indexes for fast lookup
CREATE INDEX idx_team_members_qr_identity ON team_members(qr_identity);
CREATE INDEX idx_team_members_manual_token ON team_members(manual_token);
CREATE INDEX idx_registrations_leader ON registrations(leader_id);
CREATE INDEX idx_teams_registration ON teams(registration_id);
