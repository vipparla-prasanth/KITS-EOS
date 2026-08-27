-- 006_documents_certificates

CREATE TYPE document_entity_type AS ENUM ('REGISTRATION', 'STUDENT_ID', 'OTHER');
CREATE TYPE certificate_type AS ENUM ('WINNER', 'RUNNER', 'PARTICIPANT');
CREATE TYPE certificate_status AS ENUM ('LOCKED', 'UNLOCKED');

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type document_entity_type NOT NULL,
    entity_id UUID NOT NULL,
    storage_path VARCHAR(1024) UNIQUE NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
    sub_event_id UUID NOT NULL REFERENCES sub_events(id) ON DELETE RESTRICT,
    type certificate_type NOT NULL,
    status certificate_status NOT NULL DEFAULT 'LOCKED',
    student_corrections_used INTEGER NOT NULL DEFAULT 0,
    storage_path VARCHAR(1024),
    UNIQUE(team_member_id, sub_event_id)
);

CREATE INDEX idx_certificates_team_member ON certificates(team_member_id);

CREATE TABLE certificate_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    certificate_id UUID NOT NULL REFERENCES certificates(id) ON DELETE RESTRICT,
    corrected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    old_snapshot_name VARCHAR(255) NOT NULL,
    new_snapshot_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
