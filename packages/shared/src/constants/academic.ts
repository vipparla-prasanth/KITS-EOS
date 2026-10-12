/**
 * Authoritative Academic Constants for KITS-EOS
 * 
 * Single source of truth for:
 * - Departments
 * - College directory (pinned and approved institutions)
 * - Helper utilities for college/department validation and normalization
 */

export const DEPARTMENTS = [
  'Computer Science and Engineering',
  'Data Science',
  'Artificial Intelligence and Data Science',
  'Artificial Intelligence & Machine Learning',
  'Information Technology',
  'Electronics and Communication Engineering',
  'Electrical and Electronics Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'Aerospace Engineering',
  'Biomedical Engineering',
  'Biotechnology',
  'Robotics and Automation',
  'Management Studies (MBA)',
  'Commerce (B.Com)',
  'Science and Humanities',
  'OTHER'
] as const;

export type Department = (typeof DEPARTMENTS)[number] | string;

/**
 * Pinned Top Colleges (must always appear first and retain exact order)
 */
export const PINNED_COLLEGES = [
  'KITS Akshar Institute of Technology',
  'KKR & KSR Institute of Technology and Sciences'
] as const;

/**
 * Approved Colleges in strictly preserved order
 */
export const APPROVED_COLLEGES = [
  'A.S.N. Women’s Engineering College',
  'Acharya Nagarjuna University College of Engineering',
  'A.M. Reddy Memorial College of Engineering & Technology',
  'Amara Institute of Engineering & Technology',
  'Bapatla Engineering College',
  'Bapatla Women’s Engineering College',
  'Chalapathi Institute of Engineering and Technology',
  'Chebrolu Engineering College',
  'Eshwar College of Engineering',
  'GVR & S College of Engineering & Technology',
  'Hindu College of Engineering and Technology',
  'K L Deemed to be University',
  'Kallam Haranadhareddy Institute of Technology',
  'Loyola Institute of Technology and Management',
  'Malineni Lakshmaiah Women’s Engineering College',
  'Malineni Perumallu Educational Society’s Group of Institutions',
  'Nalanda Institute of Engineering & Technology',
  'Narasaraopeta Engineering College',
  'Newton’s Institute of Engineering',
  'NRI Institute of Technology',
  'Priyadarshini Institute of Technology & Management',
  'Priyadarshini Institute of Technology & Science',
  'R.V.R. & J.C. College of Engineering',
  'Sai Tirumala NVR Engineering College',
  'Sri Mittapalli College of Engineering',
  'SRM University AP',
  'St. Mary\'s Group of Institutions',
  'St. Mary\'s Women’s Engineering College',
  'Universal College of Engineering and Technology',
  'University College of Engineering JNTUK',
  'Vasireddy Venkatadri Institute of Technology',
  'Vignan\'s Foundation for Science, Technology & Research',
  'Vignan\'s LARA Institute of Technology & Science',
  'Vignan’s Nirula Institute of Technology and Science for Women',
  'VIT-AP University',
  'VRIT Engineering College'
] as const;

export const OTHER_COLLEGE_OPTION = 'Other' as const;

export const DEFAULT_COLLEGE = 'KITS Akshar Institute of Technology';

/**
 * Standard list of all 38 predefined colleges (pinned + approved)
 */
export const STANDARD_COLLEGES: readonly string[] = [
  ...PINNED_COLLEGES,
  ...APPROVED_COLLEGES
];

/**
 * Full options array including 'Other'
 */
export const ALL_COLLEGE_OPTIONS: readonly string[] = [
  ...PINNED_COLLEGES,
  ...APPROVED_COLLEGES,
  OTHER_COLLEGE_OPTION
];

/**
 * Checks if a given college name is one of the standard predefined colleges
 */
export function isStandardCollege(collegeName: string | null | undefined): boolean {
  if (!collegeName || typeof collegeName !== 'string') return false;
  const trimmed = collegeName.trim().toLowerCase();
  return STANDARD_COLLEGES.some(c => c.toLowerCase() === trimmed);
}
