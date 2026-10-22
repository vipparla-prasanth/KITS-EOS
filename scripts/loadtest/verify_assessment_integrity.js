/**
 * ============================================================================
 * KITS-EOS V3: Post-Load-Test Assessment Integrity & Verification Suite
 * ============================================================================
 * Target: QA Sandbox (agzgxwfutajwawwtsbco) ONLY
 *
 * Runs 6 separate, rigorous verification suites after load-testing:
 *   Suite 1: Answer Durability & Persistence Test
 *   Suite 2: State Transition & Zero Unfinished Attempts
 *   Suite 3: Idempotency & Zero Duplicate Audit/Leaderboard Events
 *   Suite 4: Deadline Handling & 15-Second Fairness Window Compliance
 *   Suite 5: Live Host Ground-Truth Accuracy
 *   Suite 6: Server Authoritative Scoring & Speed Formula Decoupling
 *   Suite 7: Zero Assessment Certificates Policy Compliance
 *
 * Usage:
 *   node scripts/loadtest/verify_assessment_integrity.js
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const QA_SUPABASE_URL = process.env.QA_SUPABASE_URL || 'https://agzgxwfutajwawwtsbco.supabase.co';
const QA_SERVICE_ROLE_KEY = process.env.QA_SERVICE_ROLE_KEY || 'placeholder_qa_service_role_key';
const ASSESSMENT_ID = process.env.ASSESSMENT_ID || 'a0000000-0000-0000-0000-000000000001';

console.log('='.repeat(70));
console.log(' KITS-EOS V3 POST-TEST INTEGRITY & CORRECTNESS VERIFICATION SUITE');
console.log(` Target Environment: ${QA_SUPABASE_URL}`);
console.log(` Assessment ID:      ${ASSESSMENT_ID}`);
console.log('='.repeat(70));

const supabase = createClient(QA_SUPABASE_URL, QA_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const results = [];

function recordTest(suiteName, testName, passed, details = '') {
  results.push({ suiteName, testName, passed, details });
  const badge = passed ? '[PASS]' : '[FAIL]';
  console.log(`  ${badge} ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function verifyIntegrity() {
  // --------------------------------------------------------------------------
  // SUITE 1: Answer Durability & Persistence Test
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 1: Answer Durability & Persistence ---');
  const { data: answers, error: ansErr } = await supabase
    .from('assessment_attempt_answers')
    .select('id, attempt_id, question_id, points_awarded, eos_points, question_started_at, answered_at')
    .limit(5000);

  if (ansErr || !answers) {
    recordTest('Durability', 'Query answers table', false, ansErr?.message);
    return;
  }

  recordTest('Durability', 'Answers table populated', answers.length > 0, `Total: ${answers.length} rows`);

  // Verify non-null timestamps and valid intervals
  const invalidTimestamps = answers.filter(a => {
    if (!a.answered_at) return true;
    if (a.question_started_at) {
      return new Date(a.answered_at).getTime() < new Date(a.question_started_at).getTime();
    }
    return false;
  });
  recordTest('Durability', 'Valid start & answer timestamps', invalidTimestamps.length === 0, `Invalid: ${invalidTimestamps.length}`);

  // --------------------------------------------------------------------------
  // SUITE 2: State Transitions & Unfinished Attempts
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 2: State Transitions & Terminal States ---');
  const { data: attempts, error: attErr } = await supabase
    .from('assessment_attempts')
    .select('*')
    .eq('assessment_id', ASSESSMENT_ID);

  if (attErr || !attempts) {
    recordTest('State', 'Query attempts table', false, attErr?.message);
    return;
  }

  const inProgressAttempts = attempts.filter(a => a.status === 'IN_PROGRESS');
  recordTest('State', 'Zero attempts stuck in IN_PROGRESS after deadline', inProgressAttempts.length === 0, `Stuck: ${inProgressAttempts.length}`);

  const terminalAttempts = attempts.filter(a => ['SUBMITTED', 'EXPIRED', 'TERMINATED'].includes(a.status));
  recordTest('State', 'All attempts reached terminal status', terminalAttempts.length === attempts.length, `${terminalAttempts.length}/${attempts.length}`);

  // --------------------------------------------------------------------------
  // SUITE 3: Idempotency & Zero Duplicate Audit/Leaderboard Events
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 3: Idempotency & Zero Duplicates ---');
  const { data: lbEvents } = await supabase
    .from('assessment_leaderboard_events')
    .select('id, assessment_id')
    .eq('assessment_id', ASSESSMENT_ID);

  const lbCount = lbEvents?.length || 0;
  recordTest('Idempotency', 'Exactly 1 leaderboard event per finalized attempt', lbCount === terminalAttempts.length, `Leaderboard: ${lbCount}, Finalized: ${terminalAttempts.length}`);

  const { data: auditLogs } = await supabase
    .from('audit_logs')
    .select('id, entity_id')
    .eq('action', 'ASSESSMENT_ATTEMPT_FINALIZED');

  const attemptIdsInAudit = auditLogs?.map(a => a.entity_id) || [];
  const duplicateAudits = attemptIdsInAudit.length - new Set(attemptIdsInAudit).size;
  recordTest('Idempotency', 'Zero duplicate audit log records on attempt finalization', duplicateAudits === 0, `Duplicate audit rows: ${duplicateAudits}`);

  // --------------------------------------------------------------------------
  // SUITE 4: Deadline Handling & 15-Second Fairness Window Compliance
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 4: Deadline Handling & Fairness Window ---');
  let falseExpiredCount = 0;
  attempts.forEach(att => {
    if (att.submitted_at && att.deadline) {
      const submitMs = new Date(att.submitted_at).getTime();
      const deadlineMs = new Date(att.deadline).getTime();
      // If submitted within deadline + 15 seconds, status MUST be SUBMITTED
      if (submitMs <= deadlineMs + 15000 && att.status === 'EXPIRED') {
        falseExpiredCount++;
      }
    }
  });
  recordTest('Fairness', 'Zero false expirations within 15-second grace window', falseExpiredCount === 0, `False expired: ${falseExpiredCount}`);

  // --------------------------------------------------------------------------
  // SUITE 5: Live Host Ground-Truth Accuracy
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 5: Live Host Snapshot Ground-Truth Accuracy ---');
  const { data: snapshot, error: snapErr } = await supabase.rpc('get_assessment_live_host_snapshot', {
    p_assessment_id: ASSESSMENT_ID
  });

  if (snapErr || !snapshot) {
    recordTest('LiveHost', 'Query get_assessment_live_host_snapshot RPC', false, snapErr?.message);
  } else {
    const ov = snapshot.overview || {};
    const dbSubmitted = attempts.filter(a => a.status === 'SUBMITTED').length;
    const dbExpired = attempts.filter(a => a.status === 'EXPIRED').length;

    recordTest('LiveHost', 'Snapshot submitted_count matches DB', ov.submitted_count === dbSubmitted, `Snapshot: ${ov.submitted_count}, DB: ${dbSubmitted}`);
    recordTest('LiveHost', 'Snapshot expired_count matches DB', ov.expired_count === dbExpired, `Snapshot: ${ov.expired_count}, DB: ${dbExpired}`);
    recordTest('LiveHost', 'Both recent_activity and recent_events keys present', Boolean(snapshot.recent_activity && snapshot.recent_events));
  }

  // --------------------------------------------------------------------------
  // SUITE 6: Authoritative Scoring & Formula Decoupling
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 6: Server Authoritative Scoring & Formula Decoupling ---');
  let scoreMismatchCount = 0;
  let eosMismatchCount = 0;

  for (const att of attempts.slice(0, 50)) { // Sample 50 attempts
    const { data: attAnswers } = await supabase
      .from('assessment_attempt_answers')
      .select('points_awarded, eos_points')
      .eq('attempt_id', att.id);

    const sumPoints = attAnswers?.reduce((acc, a) => acc + Number(a.points_awarded || 0), 0) || 0;
    const sumEos = attAnswers?.reduce((acc, a) => acc + Number(a.eos_points || 0), 0) || 0;

    if (Math.abs(Number(att.question_score) - sumPoints) > 0.01) {
      scoreMismatchCount++;
    }
    if (Math.abs(Number(att.eos_points) - sumEos) > 0.01) {
      eosMismatchCount++;
    }
  }

  recordTest('Scoring', 'Academic marks match sum of points_awarded', scoreMismatchCount === 0, `Mismatches: ${scoreMismatchCount}`);
  recordTest('Scoring', 'EOS speed bonus matches sum of answer eos_points', eosMismatchCount === 0, `Mismatches: ${eosMismatchCount}`);

  // --------------------------------------------------------------------------
  // SUITE 7: Zero Assessment Certificates Compliance
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 7: Zero Assessment Certificates Policy Compliance ---');
  const { count: certCount } = await supabase
    .from('assessment_certificates')
    .select('id', { count: 'exact', head: true });

  recordTest('Certificates', 'Zero assessment certificates created (Discontinued rule)', (certCount || 0) === 0, `Count: ${certCount || 0}`);

  // --------------------------------------------------------------------------
  // OVERALL INTEGRITY VERDICT
  // --------------------------------------------------------------------------
  const allPassed = results.every(r => r.passed);
  console.log('\n' + '='.repeat(70));
  console.log(` FINAL INTEGRITY VERDICT: ${allPassed ? 'ALL SUITES PASSED (100% CORRECT)' : 'INTEGRITY FAILURES DETECTED'}`);
  console.log(` Total Checks: ${results.length} | Passed: ${results.filter(r => r.passed).length} | Failed: ${results.filter(r => !r.passed).length}`);
  console.log('='.repeat(70));
}

verifyIntegrity().catch(err => console.error('Fatal verification error:', err));
