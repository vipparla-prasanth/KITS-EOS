-- ============================================================================
-- QA SYNTHETIC TEST DATA SEED SCRIPT (PROPOSAL ONLY - DO NOT RUN DIRECTLY)
-- Target Database: QA Project (agzgxwfutajwawwtsbco)
-- Purpose: Seeds 100% synthetic, non-production data for 50/100/250/300 VU load tests
-- Safety: NEVER touches or copies production student data
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. BASE EVENT & SUB-EVENT
-- ----------------------------------------------------------------------------
INSERT INTO public.events (
    id, name, description, status, start_date, end_date, status_mode, manual_status
) VALUES (
    'e0000000-0000-0000-0000-000000000001',
    'KITS Akshar QA Benchmark Fest 2026',
    'Dedicated synthetic load-testing event container for KITS-EOS V3.',
    'ACTIVE',
    now() - interval '1 day',
    now() + interval '7 days',
    'MANUAL',
    'ONGOING'
) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

INSERT INTO public.categories (
    id, event_id, name, description, status
) VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001',
    'Technical Assessments',
    'Online assessments category for load benchmarks.',
    'ACTIVE'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sub_events (
    id, category_id, event_id, name, description, status, participation_type, max_team_size, is_free
) VALUES (
    's0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001',
    'CodeSprint & EOS Speed Sprint 2026',
    'High-concurrency benchmark examination container.',
    'ACTIVE',
    'SOLO',
    1,
    true
) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

-- ----------------------------------------------------------------------------
-- 2. BENCHMARK ASSESSMENT CONTAINER (50 Questions, Speed Bonus Enabled)
-- ----------------------------------------------------------------------------
INSERT INTO public.assessments (
    id, event_id, sub_event_id, title, description, instructions,
    duration_minutes, start_time, end_time, status, passing_percentage,
    total_questions_count, include_in_global_leaderboard,
    randomize_questions, randomize_options, speed_bonus_config
) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000001',
    's0000000-0000-0000-0000-000000000001',
    'KITS-EOS Concurrency Benchmark Assessment (300 VUs)',
    'Synthetic stress test assessment designed to validate deadline stampede & autosave IOPS.',
    'Answer all 50 questions. Questions feature non-linear Kahoot speed bonus points decay.',
    30,
    now() - interval '1 hour',
    now() + interval '3 hours',
    'PUBLISHED',
    40.00,
    50,
    true,
    false,
    false,
    '{"enabled": true, "max_eos_points": 1000, "default_time_limit_seconds": 30}'::jsonb
) ON CONFLICT (id) DO UPDATE
SET status = 'PUBLISHED',
    total_questions_count = 50,
    end_time = now() + interval '3 hours';

-- ----------------------------------------------------------------------------
-- 3. 50 SYNTHETIC QUESTIONS WITH OPTIONS & KEYS
-- ----------------------------------------------------------------------------
-- Clean existing questions for this assessment
DELETE FROM public.assessment_questions WHERE assessment_id = 'a0000000-0000-0000-0000-000000000001';

DO $$
DECLARE
    v_q_id UUID;
    v_opt_correct_id UUID;
    v_opt_wrong_id UUID;
    i INT;
BEGIN
    FOR i IN 1..50 LOOP
        v_q_id := ('b0000000-0000-0000-0000-' || LPAD(i::text, 12, '0'))::UUID;

        IF i <= 40 THEN
            -- MCQ Question
            INSERT INTO public.assessment_questions (
                id, assessment_id, question_text, question_type, points, sort_order, time_limit_seconds, is_active_for_assessment
            ) VALUES (
                v_q_id,
                'a0000000-0000-0000-0000-000000000001',
                'Synthetic Question ' || i || ': What is the time complexity of operation #' || i || '?',
                'MCQ',
                2.00,
                i,
                30,
                true
            );

            -- Option 1 (Correct)
            v_opt_correct_id := ('c0000000-0000-0000-0001-' || LPAD(i::text, 12, '0'))::UUID;
            INSERT INTO public.assessment_question_options (id, question_id, option_text, sort_order)
            VALUES (v_opt_correct_id, v_q_id, 'O(1) Constant Time (Correct)', 1);

            -- Options 2, 3, 4 (Distractors)
            INSERT INTO public.assessment_question_options (id, question_id, option_text, sort_order) VALUES
            (('c0000000-0000-0000-0002-' || LPAD(i::text, 12, '0'))::UUID, v_q_id, 'O(N) Linear Time', 2),
            (('c0000000-0000-0000-0003-' || LPAD(i::text, 12, '0'))::UUID, v_q_id, 'O(N log N) Log-linear', 3),
            (('c0000000-0000-0000-0004-' || LPAD(i::text, 12, '0'))::UUID, v_q_id, 'O(N^2) Quadratic', 4);

            -- Key
            INSERT INTO public.assessment_question_keys (question_id, option_id, correct_boolean)
            VALUES (v_q_id, v_opt_correct_id, NULL);

        ELSE
            -- TRUE_FALSE Question
            INSERT INTO public.assessment_questions (
                id, assessment_id, question_text, question_type, points, sort_order, time_limit_seconds, is_active_for_assessment
            ) VALUES (
                v_q_id,
                'a0000000-0000-0000-0000-000000000001',
                'Synthetic Question ' || i || ': PostgreSQL uses MVCC for read consistency.',
                'TRUE_FALSE',
                1.00,
                i,
                20,
                true
            );

            INSERT INTO public.assessment_question_keys (question_id, option_id, correct_boolean)
            VALUES (v_q_id, NULL, true);
        END IF;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. 300 SYNTHETIC STUDENT CANDIDATES (auth.users + public.users + profiles)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_student_id UUID;
    v_email TEXT;
    v_roll TEXT;
    v_name TEXT;
    i INT;
BEGIN
    FOR i IN 1..300 LOOP
        v_student_id := ('d0000000-0000-0000-0000-' || LPAD(i::text, 12, '0'))::UUID;
        v_email := 'qa_student_' || LPAD(i::text, 3, '0') || '@kits-eos.test';
        v_roll := '26QA' || LPAD(i::text, 4, '0');
        v_name := 'QA Candidate ' || LPAD(i::text, 3, '0');

        -- auth.users record (bypasses auth email confirmation in QA)
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
            v_student_id,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            v_email,
            extensions.crypt('QAPassword2026!', extensions.gen_salt('bf')),
            now(),
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            jsonb_build_object('full_name', v_name),
            now(),
            now()
        ) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

        -- public.users record
        INSERT INTO public.users (id, email, role, status)
        VALUES (v_student_id, v_email, 'STUDENT', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

        -- public.student_profiles record
        INSERT INTO public.student_profiles (
            user_id, full_name, roll_number, college, department, year_of_study, phone, account_status
        ) VALUES (
            v_student_id,
            v_name,
            v_roll,
            'KITS Akshar Testing Sandbox',
            'COMPUTER_SCIENCE',
            3,
            '98000' || LPAD(i::text, 5, '0'),
            'ACTIVE'
        ) ON CONFLICT (user_id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            roll_number = EXCLUDED.roll_number;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. HOST COORDINATOR ACCOUNT & ASSIGNMENT
-- ----------------------------------------------------------------------------
INSERT INTO public.coordinators (
    id, username, password_hash, display_name, phone_number, status, coordinator_type
) VALUES (
    'f0000000-0000-0000-0000-000000000001',
    'qa_coordinator',
    encode(extensions.digest('CoordinatorPass2026!', 'sha256'), 'hex'),
    'Prof. QA Host Coordinator',
    '9876543210',
    'ACTIVE',
    'FACULTY'
) ON CONFLICT (username) DO UPDATE
SET status = 'ACTIVE',
    password_hash = EXCLUDED.password_hash;

INSERT INTO public.assessment_coordinator_assignments (
    assessment_id, coordinator_id, assigned_at
) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    now()
) ON CONFLICT (assessment_id) DO UPDATE
SET coordinator_id = EXCLUDED.coordinator_id;

COMMIT;
