-- 007_feedback_complaints

CREATE TYPE complaint_status AS ENUM ('OPEN', 'RESOLVED', 'CLOSED');

CREATE TABLE feedback_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_event_id UUID NOT NULL REFERENCES sub_events(id) ON DELETE RESTRICT,
    registration_id UUID UNIQUE NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
    rating_1 INTEGER NOT NULL CHECK (rating_1 >= 1 AND rating_1 <= 5),
    rating_2 INTEGER NOT NULL CHECK (rating_2 >= 1 AND rating_2 <= 5),
    rating_3 INTEGER NOT NULL CHECK (rating_3 >= 1 AND rating_3 <= 5),
    rating_4 INTEGER NOT NULL CHECK (rating_4 >= 1 AND rating_4 <= 5),
    rating_5 INTEGER NOT NULL CHECK (rating_5 >= 1 AND rating_5 <= 5),
    comments TEXT
);

CREATE TABLE complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    category VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status complaint_status NOT NULL DEFAULT 'OPEN',
    resolution TEXT
);
