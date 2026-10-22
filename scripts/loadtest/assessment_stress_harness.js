/**
 * ============================================================================
 * KITS-EOS V3: Assessment Concurrency Load-Test Harness
 * ============================================================================
 * Target: QA Sandbox (agzgxwfutajwawwtsbco) ONLY
 * Supported Tiers: 50, 100, 250, 300 Concurrent Synthetic Virtual Users (VUs)
 *
 * Simulates real assessment operations:
 *   1. VU Authentication & Session Initialization
 *   2. Exam Start / Resume (student_start_or_resume_attempt)
 *   3. Out-of-order Question View Pings (student_view_question)
 *   4. Concurrent Autosave Bursts (student_autosave_answer)
 *   5. Deadline Stampede Finalization (student_submit_attempt with client jitter)
 *   6. Network Retries & Duplicate Submissions (idempotency verification)
 *   7. Concurrent Host Coordinator Snapshot Polling (get_assessment_live_host_snapshot)
 *
 * Usage:
 *   node scripts/loadtest/assessment_stress_harness.js --vus 50
 *   node scripts/loadtest/assessment_stress_harness.js --vus 100
 *   node scripts/loadtest/assessment_stress_harness.js --vus 250
 *   node scripts/loadtest/assessment_stress_harness.js --vus 300
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const QA_SUPABASE_URL = process.env.QA_SUPABASE_URL || 'https://agzgxwfutajwawwtsbco.supabase.co';
const QA_SUPABASE_ANON_KEY = process.env.QA_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder_qa_anon_key';
const ASSESSMENT_ID = process.env.ASSESSMENT_ID || 'a0000000-0000-0000-0000-000000000001';

// Parse command line arguments
const args = process.argv.slice(2);
const vusArgIndex = args.indexOf('--vus');
const TARGET_VUS = vusArgIndex !== -1 ? parseInt(args[vusArgIndex + 1], 10) : 50;

if (![50, 100, 250, 300].includes(TARGET_VUS)) {
  console.warn(`[WARN] Requested ${TARGET_VUS} VUs. Recommended standard tiers are 50, 100, 250, or 300.`);
}

console.log('='.repeat(70));
console.log(` KITS-EOS V3 LOAD-TEST HARNESS: ${TARGET_VUS} CONCURRENT CANDIDATES`);
console.log(` Target Environment: ${QA_SUPABASE_URL}`);
console.log(` Assessment ID:      ${ASSESSMENT_ID}`);
console.log('='.repeat(70));

// Benchmark metrics collector
const metrics = {
  autosaves: { total: 0, errors: 0, latencies: [] },
  submissions: { total: 0, errors: 0, http504s: 0, latencies: [] },
  viewPings: { total: 0, errors: 0, latencies: [] },
  hostSnapshots: { total: 0, errors: 0, latencies: [] },
  idempotentRetries: { total: 0, passed: 0, errors: 0 }
};

function recordLatency(metricObj, ms, isError = false, is504 = false) {
  metricObj.total++;
  metricObj.latencies.push(ms);
  if (isError) metricObj.errors++;
  if (is504 && metricObj.http504s !== undefined) metricObj.http504s++;
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const max = sorted[sorted.length - 1] || 0;
  return { p50, p95, p99, max };
}

// Single candidate virtual-user flow
async function runVirtualUser(vuIndex) {
  const padIndex = String(vuIndex).padStart(3, '0');
  const email = `qa_student_${padIndex}@kits-eos.test`;
  const password = 'QAPassword2026!';

  const client = createClient(QA_SUPABASE_URL, QA_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });

  try {
    // 1. Sign In
    const authStart = Date.now();
    const { data: authData, error: authError } = await client.auth.signInWithPassword({
      email,
      password
    });
    if (authError || !authData.session) {
      throw new Error(`VU ${vuIndex} Auth failed: ${authError?.message}`);
    }

    // 2. Start / Resume Attempt
    const { data: startData, error: startError } = await client.rpc('student_start_or_resume_attempt', {
      p_assessment_id: ASSESSMENT_ID
    });
    if (startError || !startData?.attempt_id) {
      throw new Error(`VU ${vuIndex} Start attempt failed: ${startError?.message}`);
    }
    const attemptId = startData.attempt_id;

    // 3. Question Navigation & Autosaves (Answer 25 questions randomly)
    const questionsToAnswer = 25;
    for (let q = 1; q <= questionsToAnswer; q++) {
      const qId = `b0000000-0000-0000-0000-${String(q).padStart(12, '0')}`;
      const optId = `c0000000-0000-0000-0001-${String(q).padStart(12, '0')}`;

      // 3.1 View Question Ping
      const viewStart = Date.now();
      const { error: viewError } = await client.rpc('student_view_question', {
        p_attempt_id: attemptId,
        p_question_id: qId
      });
      recordLatency(metrics.viewPings, Date.now() - viewStart, Boolean(viewError));

      // Staggered pacing: 100ms - 500ms think time per candidate
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 400) + 100));

      // 3.2 Autosave Answer
      const saveStart = Date.now();
      const { error: saveError } = await client.rpc('student_autosave_answer', {
        p_attempt_id: attemptId,
        p_question_id: qId,
        p_selected_option_id: q <= 20 ? optId : null,
        p_selected_boolean: q > 20 ? true : null
      });
      recordLatency(metrics.autosaves, Date.now() - saveStart, Boolean(saveError));
    }

    // 4. Deadline Stampede Submission
    // Safe client-side jitter simulation (1000ms - 4500ms)
    const jitterMs = Math.floor(Math.random() * 3500) + 1000;
    await new Promise(r => setTimeout(r, jitterMs));

    const submitStart = Date.now();
    let submitError = null;
    let is504 = false;

    try {
      const { error: sErr } = await client.rpc('student_submit_attempt', {
        p_attempt_id: attemptId
      });
      submitError = sErr;
    } catch (err) {
      submitError = err;
      if (String(err).includes('504')) is504 = true;
    }
    recordLatency(metrics.submissions, Date.now() - submitStart, Boolean(submitError), is504);

    // 5. Duplicate Submission / Idempotency Test (10% of VUs)
    if (vuIndex % 10 === 0) {
      metrics.idempotentRetries.total++;
      const { data: retryData, error: retryError } = await client.rpc('student_submit_attempt', {
        p_attempt_id: attemptId
      });
      if (!retryError && (retryData?.already_submitted || retryData?.success)) {
        metrics.idempotentRetries.passed++;
      } else {
        metrics.idempotentRetries.errors++;
      }
    }

  } catch (err) {
    console.error(`[VU ${vuIndex} FAIL]:`, err.message);
  }
}

// Concurrent Host Coordinator Polling
async function runCoordinatorPoller(stopSignal) {
  const coordClient = createClient(QA_SUPABASE_URL, QA_SUPABASE_ANON_KEY);
  while (!stopSignal.done) {
    const start = Date.now();
    try {
      const { error } = await coordClient.rpc('get_assessment_live_host_snapshot', {
        p_assessment_id: ASSESSMENT_ID
      });
      recordLatency(metrics.hostSnapshots, Date.now() - start, Boolean(error));
    } catch {
      recordLatency(metrics.hostSnapshots, Date.now() - start, true);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

// Master execution runner
async function main() {
  console.log(`[INFO] Launching load test with ${TARGET_VUS} concurrent virtual users...`);
  const startTime = Date.now();

  const stopSignal = { done: false };
  const pollerPromise = runCoordinatorPoller(stopSignal);

  // Ramp all VUs concurrently
  const vuPromises = [];
  for (let i = 1; i <= TARGET_VUS; i++) {
    vuPromises.push(runVirtualUser(i));
  }

  await Promise.all(vuPromises);
  stopSignal.done = true;
  await pollerPromise;

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Calculate results
  const autosaveP = calculatePercentiles(metrics.autosaves.latencies);
  const submitP = calculatePercentiles(metrics.submissions.latencies);
  const viewP = calculatePercentiles(metrics.viewPings.latencies);
  const snapP = calculatePercentiles(metrics.hostSnapshots.latencies);

  console.log('\n' + '='.repeat(70));
  console.log(` LOAD-TEST RESULTS SUMMARY (${TARGET_VUS} VUs, Total Duration: ${totalDuration}s)`);
  console.log('='.repeat(70));

  console.log(`Autosave Operations:`);
  console.log(`  Total: ${metrics.autosaves.total} | Errors: ${metrics.autosaves.errors}`);
  console.log(`  Latency: p50 = ${autosaveP.p50}ms | p95 = ${autosaveP.p95}ms | p99 = ${autosaveP.p99}ms | max = ${autosaveP.max}ms`);

  console.log(`\nFinal Submissions (Deadline Stampede):`);
  console.log(`  Total: ${metrics.submissions.total} | Errors: ${metrics.submissions.errors} | HTTP 504s: ${metrics.submissions.http504s}`);
  console.log(`  Latency: p50 = ${submitP.p50}ms | p95 = ${submitP.p95}ms | p99 = ${submitP.p99}ms | max = ${submitP.max}ms`);

  console.log(`\nIdempotent Retries:`);
  console.log(`  Tested: ${metrics.idempotentRetries.total} | Passed: ${metrics.idempotentRetries.passed} | Failed: ${metrics.idempotentRetries.errors}`);

  console.log(`\nLive Host Coordinator Snapshot Polling:`);
  console.log(`  Polls: ${metrics.hostSnapshots.total} | Errors: ${metrics.hostSnapshots.errors}`);
  console.log(`  Latency: p50 = ${snapP.p50}ms | p95 = ${snapP.p95}ms | p99 = ${snapP.p99}ms`);

  // Pass / Fail Determination
  const passCriteria = {
    zero504s: metrics.submissions.http504s === 0,
    autosaveP95: autosaveP.p95 < 350,
    submitP95: submitP.p95 < 1200,
    submitP99: submitP.p99 < 2500,
    zeroIdempotentErrors: metrics.idempotentRetries.errors === 0
  };

  const allPassed = Object.values(passCriteria).every(Boolean);

  console.log('\n' + '-'.repeat(70));
  console.log(' OBJECTIVE PASS / FAIL GATES:');
  console.log(`  [${passCriteria.zero504s ? 'PASS' : 'FAIL'}] Zero HTTP 504 Gateway Timeouts (Observed: ${metrics.submissions.http504s})`);
  console.log(`  [${passCriteria.autosaveP95 ? 'PASS' : 'FAIL'}] Autosave p95 < 350ms (Observed: ${autosaveP.p95}ms)`);
  console.log(`  [${passCriteria.submitP95 ? 'PASS' : 'FAIL'}] Submission p95 < 1200ms (Observed: ${submitP.p95}ms)`);
  console.log(`  [${passCriteria.submitP99 ? 'PASS' : 'FAIL'}] Submission p99 < 2500ms (Observed: ${submitP.p99}ms)`);
  console.log(`  [${passCriteria.zeroIdempotentErrors ? 'PASS' : 'FAIL'}] Zero duplicate submission errors (Observed: ${metrics.idempotentRetries.errors})`);
  console.log('-'.repeat(70));
  console.log(` OVERALL VERDICT: ${allPassed ? 'PASSED' : 'FAILED'}`);
  console.log('='.repeat(70));
}

main().catch(err => console.error('Fatal runner error:', err));
