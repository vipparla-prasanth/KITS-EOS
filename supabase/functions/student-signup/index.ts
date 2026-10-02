import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleError, HttpError } from "./_shared/errorHandling.ts";
import { getCorsHeaders } from "./_shared/cors.ts";

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // 1. Parse & Validate Body
    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    const {
      email,
      password,
      full_name,
      roll_number,
      college = 'KITS Akshar Institute of Technology',
      department,
      other_department = null,
      year_of_study,
      phone,
    } = body;

    // Field-by-field rigorous validation
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpError(400, 'INVALID_EMAIL', 'A valid email address is required.');
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 6 characters long.');
    }

    if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
      throw new HttpError(400, 'INVALID_NAME', 'Full legal name is required.');
    }

    if (!roll_number || typeof roll_number !== 'string' || !roll_number.trim()) {
      throw new HttpError(400, 'INVALID_ROLL_NUMBER', 'Student roll number is required.');
    }

    if (!department || typeof department !== 'string' || !department.trim()) {
      throw new HttpError(400, 'INVALID_DEPARTMENT', 'Department selection is required.');
    }

    if (department.trim() === 'OTHER' && (!other_department || typeof other_department !== 'string' || !other_department.trim())) {
      throw new HttpError(400, 'INVALID_OTHER_DEPARTMENT', 'Please specify your department name.');
    }

    const yearNum = Number(year_of_study);
    if (![1, 2, 3, 4].includes(yearNum)) {
      throw new HttpError(400, 'INVALID_YEAR', 'Year of study must be 1, 2, 3, or 4.');
    }

    if (!phone || typeof phone !== 'string' || phone.trim().length < 10) {
      throw new HttpError(400, 'INVALID_PHONE', 'A valid 10-digit contact mobile number is required.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanRollNumber = roll_number.trim().toUpperCase();
    const cleanFullName = full_name.trim();
    const cleanCollege = (college && typeof college === 'string' && college.trim()) ? college.trim() : 'KITS Akshar Institute of Technology';
    const cleanDepartment = department.trim();
    const cleanOtherDepartment = cleanDepartment === 'OTHER' ? (other_department ? other_department.trim() : null) : null;
    const cleanPhone = phone.trim();

    // 2. Pre-flight check: Unique Roll Number
    const { data: existingProfile } = await supabaseClient
      .from('student_profiles')
      .select('user_id')
      .eq('roll_number', cleanRollNumber)
      .maybeSingle();

    if (existingProfile) {
      throw new HttpError(409, 'DUPLICATE_ROLL_NUMBER', `An account with Roll Number "${cleanRollNumber}" already exists. Please sign in instead.`);
    }

    // 3. Pre-flight check: Unique Email in public.users
    const { data: existingUser } = await supabaseClient
      .from('users')
      .select('id, role')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingUser) {
      if (existingUser.role === 'ADMIN') {
        throw new HttpError(
          409,
          'ADMIN_ACCOUNT_EXISTS',
          'This email belongs to an Administrator account. To onboard as a Student, please sign in to your Administrator account first to securely link your Student profile.'
        );
      }
      throw new HttpError(409, 'DUPLICATE_EMAIL', `An account with email "${cleanEmail}" is already registered. Please sign in.`);
    }

    // 4. Create Auth User via Admin API (pre-confirms email and assigns STUDENT role)
    const { data: authData, error: authCreateError } = await supabaseClient.auth.admin.createUser({
      email: cleanEmail,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: cleanFullName,
        role: 'STUDENT',
      }
    });

    if (authCreateError || !authData?.user) {
      console.error('Auth admin.createUser error:', authCreateError);
      if (authCreateError?.message?.toLowerCase().includes('already') || authCreateError?.message?.toLowerCase().includes('exists')) {
        throw new HttpError(409, 'DUPLICATE_EMAIL', `An account with email "${cleanEmail}" is already registered. Please sign in.`);
      }
      throw new HttpError(400, 'AUTH_ERROR', authCreateError?.message || 'Failed to create student authentication account.');
    }

    const userId = authData.user.id;

    // 5. Insert student_profiles record
    const privacyVersion = body.privacy_acknowledged 
      ? (typeof body.privacy_notice_version === 'string' && body.privacy_notice_version.trim() ? body.privacy_notice_version.trim() : '1.0')
      : null;
    const privacyAcknowledgedAt = body.privacy_acknowledged ? new Date().toISOString() : null;

    const { error: profileInsertError } = await supabaseClient
      .from('student_profiles')
      .insert({
        user_id: userId,
        full_name: cleanFullName,
        roll_number: cleanRollNumber,
        college: cleanCollege,
        department: cleanDepartment,
        other_department: cleanOtherDepartment,
        year_of_study: yearNum,
        phone: cleanPhone,
        privacy_notice_version: privacyVersion,
        privacy_acknowledged_at: privacyAcknowledgedAt,
      });

    if (profileInsertError) {
      console.error('Failed to insert student_profiles:', profileInsertError);
      // Clean up orphaned user records
      await supabaseClient.from('users').delete().eq('id', userId);
      await supabaseClient.auth.admin.deleteUser(userId);
      if (profileInsertError.message?.includes('duplicate key') || profileInsertError.code === '23505') {
        throw new HttpError(409, 'DUPLICATE_PROFILE', 'A student profile with these credentials already exists.');
      }
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to save student profile information.');
    }

    if (body.privacy_acknowledged) {
      await supabaseClient.from('audit_logs').insert({
        actor_id: userId,
        action: 'PRIVACY_NOTICE_ACKNOWLEDGED',
        entity_type: 'student_profiles',
        entity_id: userId,
        metadata: {
          version: privacyVersion,
          acknowledged_at: privacyAcknowledgedAt,
          context: 'STUDENT_SIGNUP'
        }
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: userId,
          email: cleanEmail,
          full_name: cleanFullName,
        },
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    return handleError(error, corsHeaders);
  }
});
