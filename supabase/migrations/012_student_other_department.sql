-- Migration 012: Add other_department and strict year_of_study constraints

-- 1. Add other_department column
ALTER TABLE public.student_profiles
ADD COLUMN other_department VARCHAR(255);

-- 2. Enforce department and other_department rules
ALTER TABLE public.student_profiles
ADD CONSTRAINT check_other_department 
CHECK (
  (department != 'OTHER' AND other_department IS NULL) OR
  (department = 'OTHER' AND other_department IS NOT NULL)
);

-- 3. Replace the old year_of_study constraint
ALTER TABLE public.student_profiles
DROP CONSTRAINT IF EXISTS student_profiles_year_of_study_check;

ALTER TABLE public.student_profiles
ADD CONSTRAINT check_year_of_study 
CHECK (year_of_study IN (1, 2, 3, 4));
