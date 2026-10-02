-- 036_add_payment_method_to_payments.sql
-- Adds authoritative payment_method column to public.payments table,
-- creates check constraint for ('UPI', 'COD', 'ONLINE', 'FREE'),
-- backfills existing records from reference_id, and sets NOT NULL.

DO $$
BEGIN
    -- 1. Add column if it doesn't exist (initially nullable for backfilling)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'payments' 
          AND column_name = 'payment_method'
    ) THEN
        ALTER TABLE public.payments 
        ADD COLUMN payment_method VARCHAR(20) DEFAULT 'UPI';
    END IF;
END $$;

-- 2. Backfill existing payment records from reference_id prefix
UPDATE public.payments
SET payment_method = CASE
    WHEN reference_id ILIKE 'COD%' THEN 'COD'
    WHEN reference_id ILIKE 'FREE%' THEN 'FREE'
    WHEN reference_id ILIKE 'ONLINE%' THEN 'ONLINE'
    ELSE 'UPI'
END
WHERE payment_method IS NULL OR payment_method = 'UPI';

-- 3. Set NOT NULL and default value
ALTER TABLE public.payments 
ALTER COLUMN payment_method SET NOT NULL;

ALTER TABLE public.payments 
ALTER COLUMN payment_method SET DEFAULT 'UPI';

-- 4. Add check constraint
ALTER TABLE public.payments 
DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE public.payments 
ADD CONSTRAINT payments_payment_method_check 
CHECK (payment_method IN ('UPI', 'COD', 'ONLINE', 'FREE'));

-- 5. Create index for efficient querying by payment_method
CREATE INDEX IF NOT EXISTS idx_payments_payment_method 
ON public.payments(payment_method);

-- 6. Reload PostgREST schema cache so the column is immediately queryable via the API
NOTIFY pgrst, 'reload schema';
