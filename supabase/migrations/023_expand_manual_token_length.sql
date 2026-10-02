-- 023_expand_manual_token_length.sql
-- Expands manual_token on team_members to accommodate the KITS-EOS-{SUB_EVENT_NAME}-XXXXXXXXXX format.

ALTER TABLE public.team_members 
  ALTER COLUMN manual_token TYPE VARCHAR(100);
