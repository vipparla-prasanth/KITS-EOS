/**
 * KITS-EOS Assessment Messaging System
 * ============================================================================
 * Provides campus-appropriate funny, motivational, and serious feedback messages
 * across the student examination experience (Pre-Exam, Active Attempt, Autosave,
 * Proctoring Warnings, Low Time Reminders, and Result Delivery).
 * 
 * CRITICAL INTEGRITY REQUIREMENT:
 * During active attempts, messages MUST NEVER reveal or hint at answer correctness.
 * Correct and incorrect answer selections strictly share the exact same non-revealing
 * reaction pool.
 */

export type AssessmentMessageCategory = 'FUNNY' | 'MOTIVATIONAL' | 'SERIOUS';

export type AssessmentMessageTrigger =
  | 'PRE_EXAM_RULES'
  | 'PRE_EXAM_COUNTDOWN'
  | 'PRE_EXAM_READY'
  | 'ANSWER_SELECTED'
  | 'AUTOSAVE_SAVING'
  | 'AUTOSAVE_SAVED'
  | 'AUTOSAVE_ERROR'
  | 'CONNECTION_OFFLINE'
  | 'CONNECTION_RECONNECTING'
  | 'PROCTORING_STRIKE_1'
  | 'PROCTORING_STRIKE_2'
  | 'PROCTORING_TERMINATED'
  | 'LOW_TIME_WARNING'
  | 'LOW_TIME_CRITICAL'
  | 'EXAM_TIME_EXPIRED'
  | 'SUBMISSION_PENDING'
  | 'SUBMISSION_SUCCESS'
  | 'SUBMISSION_FAILED'
  | 'RESULT_FINALIZED_AWARD'
  | 'RESULT_QUALIFYING_PASS'
  | 'RESULT_ENCOURAGEMENT';

export interface AssessmentMessage {
  id: string;
  trigger: AssessmentMessageTrigger;
  category: AssessmentMessageCategory;
  text: string;
}

export const ASSESSMENT_MESSAGES: AssessmentMessage[] = [
  // --------------------------------------------------------------------------
  // Pre-Exam Rules & Preparation
  // --------------------------------------------------------------------------
  {
    id: 'pre-1',
    trigger: 'PRE_EXAM_RULES',
    category: 'MOTIVATIONAL',
    text: 'Trust your preparation. Take it one question at a time.',
  },
  {
    id: 'pre-2',
    trigger: 'PRE_EXAM_RULES',
    category: 'FUNNY',
    text: 'Even a compiler needs a moment. Read the instructions carefully.',
  },
  {
    id: 'pre-3',
    trigger: 'PRE_EXAM_RULES',
    category: 'SERIOUS',
    text: 'Full-screen mode and window focus monitoring will be active during this examination.',
  },

  // --------------------------------------------------------------------------
  // Pre-Exam 2-Minute Countdown
  // --------------------------------------------------------------------------
  {
    id: 'cd-1',
    trigger: 'PRE_EXAM_COUNTDOWN',
    category: 'FUNNY',
    text: 'Your brain is loading… give it a second to cache all formulas!',
  },
  {
    id: 'cd-2',
    trigger: 'PRE_EXAM_COUNTDOWN',
    category: 'MOTIVATIONAL',
    text: 'Take a deep breath and center your focus. The examination will unlock shortly.',
  },
  {
    id: 'cd-3',
    trigger: 'PRE_EXAM_COUNTDOWN',
    category: 'FUNNY',
    text: 'No panic mode. Grab a sip of water and prepare your mind.',
  },
  {
    id: 'cd-4',
    trigger: 'PRE_EXAM_COUNTDOWN',
    category: 'MOTIVATIONAL',
    text: 'Progress comes from showing up and giving your absolute best.',
  },

  // --------------------------------------------------------------------------
  // Pre-Exam Ready
  // --------------------------------------------------------------------------
  {
    id: 'ready-1',
    trigger: 'PRE_EXAM_READY',
    category: 'MOTIVATIONAL',
    text: 'Everything is verified and ready. Best of luck with your assessment!',
  },
  {
    id: 'ready-2',
    trigger: 'PRE_EXAM_READY',
    category: 'FUNNY',
    text: 'Debug mode: ON. Confidence: 100%. Let’s do this!',
  },

  // --------------------------------------------------------------------------
  // Answer Selection Reactions (STRICTLY NON-REVEALING REACTION POOL)
  // Shared equally by all answers; NO correctness hints or scoring signals.
  // --------------------------------------------------------------------------
  {
    id: 'ans-1',
    trigger: 'ANSWER_SELECTED',
    category: 'MOTIVATIONAL',
    text: 'Answer recorded. Keep that steady pace!',
  },
  {
    id: 'ans-2',
    trigger: 'ANSWER_SELECTED',
    category: 'FUNNY',
    text: 'Locked in. Even the fastest algorithms take a cycle!',
  },
  {
    id: 'ans-3',
    trigger: 'ANSWER_SELECTED',
    category: 'MOTIVATIONAL',
    text: 'One question closer to the finish line. Stay focused!',
  },
  {
    id: 'ans-4',
    trigger: 'ANSWER_SELECTED',
    category: 'FUNNY',
    text: 'Option noted. Syntax clean, focus unbroken!',
  },
  {
    id: 'ans-5',
    trigger: 'ANSWER_SELECTED',
    category: 'MOTIVATIONAL',
    text: 'Good momentum. Move purposefully to the next question.',
  },
  {
    id: 'ans-6',
    trigger: 'ANSWER_SELECTED',
    category: 'FUNNY',
    text: 'Response registered. No overthinking — trust your preparation!',
  },
  {
    id: 'ans-7',
    trigger: 'ANSWER_SELECTED',
    category: 'MOTIVATIONAL',
    text: 'Patience and precision win the race. Keep going!',
  },
  {
    id: 'ans-8',
    trigger: 'ANSWER_SELECTED',
    category: 'FUNNY',
    text: 'Stored and logged. Your cognitive CPU is running at peak clock speed!',
  },

  // --------------------------------------------------------------------------
  // Server-Enforced Autosave States
  // --------------------------------------------------------------------------
  {
    id: 'auto-1',
    trigger: 'AUTOSAVE_SAVING',
    category: 'SERIOUS',
    text: 'Synchronizing answer with examination server...',
  },
  {
    id: 'auto-2',
    trigger: 'AUTOSAVE_SAVED',
    category: 'SERIOUS',
    text: 'Your answer has been saved securely.',
  },
  {
    id: 'auto-3',
    trigger: 'AUTOSAVE_ERROR',
    category: 'SERIOUS',
    text: 'Autosave temporarily interrupted. Retrying automatically...',
  },

  // --------------------------------------------------------------------------
  // Connection Telemetry
  // --------------------------------------------------------------------------
  {
    id: 'conn-1',
    trigger: 'CONNECTION_OFFLINE',
    category: 'SERIOUS',
    text: 'Your internet connection was interrupted. Offline mode active — please do not close the window.',
  },
  {
    id: 'conn-2',
    trigger: 'CONNECTION_RECONNECTING',
    category: 'SERIOUS',
    text: 'Reconnecting to examination server telemetry...',
  },

  // --------------------------------------------------------------------------
  // Proctoring Violations & Anti-Cheat
  // --------------------------------------------------------------------------
  {
    id: 'proc-1',
    trigger: 'PROCTORING_STRIKE_1',
    category: 'SERIOUS',
    text: 'Strike 1 of 3 recorded: A window focus loss or tab switch was detected. Stay on the assessment page.',
  },
  {
    id: 'proc-2',
    trigger: 'PROCTORING_STRIKE_2',
    category: 'SERIOUS',
    text: 'URGENT WARNING: Strike 2 of 3! Further tab switches will automatically terminate your attempt.',
  },
  {
    id: 'proc-3',
    trigger: 'PROCTORING_TERMINATED',
    category: 'SERIOUS',
    text: 'Examination session terminated. Maximum proctoring strike threshold reached.',
  },

  // --------------------------------------------------------------------------
  // Time Enforcements
  // --------------------------------------------------------------------------
  {
    id: 'time-1',
    trigger: 'LOW_TIME_WARNING',
    category: 'SERIOUS',
    text: 'Authoritative server clock: 5 minutes remaining. Review any unattempted questions.',
  },
  {
    id: 'time-2',
    trigger: 'LOW_TIME_CRITICAL',
    category: 'SERIOUS',
    text: 'Final minute! Complete your active answer and prepare for submission.',
  },
  {
    id: 'time-3',
    trigger: 'EXAM_TIME_EXPIRED',
    category: 'SERIOUS',
    text: 'Examination duration has concluded. Your responses have been finalized.',
  },

  // --------------------------------------------------------------------------
  // Submission
  // --------------------------------------------------------------------------
  {
    id: 'sub-1',
    trigger: 'SUBMISSION_PENDING',
    category: 'SERIOUS',
    text: 'Submitting assessment attempt and calculating final telemetry...',
  },
  {
    id: 'sub-2',
    trigger: 'SUBMISSION_SUCCESS',
    category: 'MOTIVATIONAL',
    text: 'Your assessment has been submitted successfully! Thank you for your commitment.',
  },
  {
    id: 'sub-3',
    trigger: 'SUBMISSION_FAILED',
    category: 'SERIOUS',
    text: 'Submission encountered a server error. Your answers remain saved — please retry submission.',
  },

  // --------------------------------------------------------------------------
  // Results & Awards
  // --------------------------------------------------------------------------
  {
    id: 'res-1',
    trigger: 'RESULT_FINALIZED_AWARD',
    category: 'MOTIVATIONAL',
    text: 'Outstanding achievement! Your performance earned an official institutional award.',
  },
  {
    id: 'res-2',
    trigger: 'RESULT_QUALIFYING_PASS',
    category: 'MOTIVATIONAL',
    text: 'Congratulations! You met the institutional passing threshold.',
  },
  {
    id: 'res-3',
    trigger: 'RESULT_ENCOURAGEMENT',
    category: 'MOTIVATIONAL',
    text: 'Every examination is an opportunity to learn and grow. Great effort today!',
  },
  {
    id: 'res-4',
    trigger: 'RESULT_ENCOURAGEMENT',
    category: 'FUNNY',
    text: 'Even deep neural networks require multiple training epochs. Keep pushing forward!',
  },
];

/**
 * Filter messages by trigger
 */
export function getAssessmentMessagesByTrigger(trigger: AssessmentMessageTrigger): AssessmentMessage[] {
  return ASSESSMENT_MESSAGES.filter((m) => m.trigger === trigger);
}

/**
 * Get deterministic or rotating message for a trigger and cycle index.
 * Prevents repeating the exact same message on consecutive questions.
 */
export function getRotatingAssessmentMessage(
  trigger: AssessmentMessageTrigger,
  index: number
): AssessmentMessage | null {
  const matching = getAssessmentMessagesByTrigger(trigger);
  if (matching.length === 0) return null;
  const safeIndex = Math.abs(index) % matching.length;
  return matching[safeIndex];
}

/**
 * Get random message from trigger pool, optionally filtered by category
 */
export function getRandomAssessmentMessage(
  trigger: AssessmentMessageTrigger,
  preferredCategory?: AssessmentMessageCategory
): AssessmentMessage | null {
  let matching = getAssessmentMessagesByTrigger(trigger);
  if (preferredCategory) {
    const categoryMatches = matching.filter((m) => m.category === preferredCategory);
    if (categoryMatches.length > 0) {
      matching = categoryMatches;
    }
  }
  if (matching.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * matching.length);
  return matching[randomIndex];
}
