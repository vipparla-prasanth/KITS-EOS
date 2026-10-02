import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireRole } from "./_shared/auth.ts";
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

    // 1. Authenticate & Authorize Genuine Admin JWT
    // Verifies cryptographic signature, expiration, active status, and public.users.role === 'ADMIN'
    const identity = await requireRole(req, 'ADMIN', supabaseClient);

    // 2. Parse Payload
    let body: any;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body');
    }

    // 3. Cross-User Protection:
    // Derives target identity strictly from the verified JWT principal (identity.userId).
    // If the request attempts to specify an arbitrary or mismatched target user_id, reject immediately.
    if (body.user_id && body.user_id !== identity.userId) {
      throw new HttpError(403, 'FORBIDDEN', 'Cannot onboard or modify another user account.');
    }

    const targetUserId = identity.userId;

    // 4. Pre-Flight Check: Verify no student_profiles row already exists for this authenticated Admin
    const { data: existingProfile, error: profileCheckError } = await supabaseClient
      .from('student_profiles')
      .select('user_id')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (profileCheckError) {
      console.error('Error checking existing student profile:', profileCheckError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to verify account state.');
    }

    if (existingProfile) {
      throw new HttpError(409, 'PROFILE_EXISTS', 'Student profile already exists.');
    }

    // 5. Rigorous Input Validation BEFORE Any Auth Modifications
    const {
      password,
      full_name,
      roll_number,
      college = 'KITS Akshar Institute of Technology',
      department,
      other_department = null,
      year_of_study,
      phone,
    } = body;

    if (!password || typeof password !== 'string' || password.trim().length < 6) {
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

    const cleanPassword = password.trim();
    const cleanFullName = full_name.trim();
    const cleanRollNumber = roll_number.trim().toUpperCase();
    const cleanCollege = (college && typeof college === 'string' && college.trim()) ? college.trim() : 'KITS Akshar Institute of Technology';
    const cleanDepartment = department.trim();
    const cleanOtherDepartment = cleanDepartment === 'OTHER' ? (other_department ? other_department.trim() : null) : null;
    const cleanPhone = phone.trim();

    // Verify Roll Number Uniqueness
    const { data: existingRoll, error: rollCheckError } = await supabaseClient
      .from('student_profiles')
      .select('user_id')
      .eq('roll_number', cleanRollNumber)
      .maybeSingle();

    if (rollCheckError) {
      console.error('Error checking roll number uniqueness:', rollCheckError);
      throw new HttpError(500, 'DATABASE_ERROR', 'Failed to verify roll number uniqueness.');
    }

    if (existingRoll && existingRoll.user_id !== targetUserId) {
      throw new HttpError(409, 'DUPLICATE_ROLL_NUMBER', `A student profile with Roll Number "${cleanRollNumber}" already exists.`);
    }

    // 6. Establish Password Authentication for the SAME Auth User via Supabase Auth Admin API
    const { data: authUpdateData, error: authUpdateError } = await supabaseClient.auth.admin.updateUserById(targetUserId, {
      password: cleanPassword,
    });

    if (authUpdateError || !authUpdateData?.user) {
      console.error('Supabase Auth Admin password update failed:', authUpdateError);
      throw new HttpError(500, 'AUTH_UPDATE_FAILED', authUpdateError?.message || 'Failed to establish student password authentication.');
    }

    // 7. Create student_profiles Row
    const { data: newProfile, error: profileInsertError } = await supabaseClient
      .from('student_profiles')
      .insert({
        user_id: targetUserId,
        full_name: cleanFullName,
        roll_number: cleanRollNumber,
        college: cleanCollege,
        department: cleanDepartment,
        other_department: cleanOtherDepartment,
        year_of_study: yearNum,
        phone: cleanPhone,
      })
      .select()
      .single();

    // 8. Explicit Partial-Failure Safety & Compensation Strategy
    if (profileInsertError || !newProfile) {
      console.error('Failed to create student_profiles row after password establishment:', profileInsertError);

      // Attempt compensation: clean up any partially inserted student profile record
      await supabaseClient.from('student_profiles').delete().eq('user_id', targetUserId);

      // Record detailed server-side audit failure
      await supabaseClient.from('audit_logs').insert({
        actor_id: targetUserId,
        action: 'ADMIN_STUDENT_ONBOARDING_FAILED',
        entity_type: 'STUDENT_PROFILE',
        entity_id: targetUserId,
        metadata: {
          error: profileInsertError?.message || 'Unknown insertion error',
          target_email: identity.email,
          step: 'INSERT_STUDENT_PROFILE',
        },
      });

      throw new HttpError(500, 'PROFILE_CREATION_FAILED', 'Failed to save student profile information. System left in a recoverable state.');
    }

    // 9. Record Successful Onboarding in Server-Side Audit Logs (NEVER log passwords)
    await supabaseClient.from('audit_logs').insert({
      actor_id: targetUserId,
      action: 'ADMIN_ONBOARDED_STUDENT_PROFILE',
      entity_type: 'STUDENT_PROFILE',
      entity_id: targetUserId,
      metadata: {
        target_email: identity.email,
        roll_number: cleanRollNumber,
        department: cleanDepartment,
        year_of_study: yearNum,
        college: cleanCollege,
      },
    });

    // 10. Return 201 Created Response
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Student capability activated! You can now log into the Student Portal using your email and password.',
        profile: newProfile,
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
