import { useEffect, useState, useMemo } from 'react';
import { supabase, invokeAdminEdgeFunction } from '@kits-eos/shared/src/api/client';
import { formatDateTime12h } from '@kits-eos/shared/src/utils/date';
import { exportToExcel, exportTableToPNG } from '@kits-eos/shared/src/utils/export';
import { DownloadButton } from '../../components/ui/DownloadButton';
import { DeleteButton } from '../../components/ui/DeleteButton';
import type { StudentProfile } from '@kits-eos/shared/src/types/models';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { EmptyState } from '../../components/ui/EmptyState';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { 
  Users, 
  Search, 
  Mail, 
  Phone, 
  KeyRound, 
  Trash2, 
  Download, 
  X, 
  CheckCircle2, 
  ShieldAlert,
  FileSpreadsheet,
  Image as ImageIcon,
  AlertCircle,
  CheckSquare,
  Square,
  MinusSquare,
  Eye,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Save
} from 'lucide-react';
import { DEPARTMENTS } from '@kits-eos/shared';

// Authoritative account classification for Student Directory
function getAccountCategory(student: StudentProfile) {
  const role = (student as any).users?.role || 'STUDENT';
  const isAdmin = role === 'ADMIN';
  const isCoordinator = role === 'COORDINATOR';

  if (isAdmin) {
    return {
      isDeletable: false,
      isDualAdmin: true,
      isCoordinator: false,
      role: 'ADMIN',
      badgeLabel: 'ADMIN • STUDENT',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
      tooltip: 'Student profile is linked to an Administrator account. This account cannot be deleted through Student Directory.',
    };
  }

  if (isCoordinator) {
    return {
      isDeletable: false,
      isDualAdmin: false,
      isCoordinator: true,
      role: 'COORDINATOR',
      badgeLabel: 'COORDINATOR',
      badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
      tooltip: 'Coordinator accounts cannot be deleted through Student Directory.',
    };
  }

  return {
    isDeletable: true,
    isDualAdmin: false,
    isCoordinator: false,
    role: 'STUDENT',
    badgeLabel: 'STUDENT',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    tooltip: 'Student Account',
  };
}

// User-facing error message mapping without leaking raw DB exceptions
function mapDeleteErrorMessage(rawReason: string | undefined | null, hasProtectedAccount: boolean): string {
  if (!rawReason) {
    return 'An unexpected error occurred while processing the account deletion.';
  }
  if (
    rawReason.includes('Cannot delete non-student accounts') || 
    rawReason.includes('Administrative privileges required')
  ) {
    if (hasProtectedAccount) {
      return 'This account has Administrator privileges and a linked Student profile. It cannot be deleted through Student Directory.';
    }
    return 'Administrator accounts cannot be deleted through Student Directory.';
  }
  if (rawReason.includes('Authentication required')) {
    return 'Your session has expired. Please sign in again.';
  }
  if (rawReason.includes('User not found')) {
    return 'The requested account was not found in the directory.';
  }
  return rawReason;
}

export function StudentsList() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Multi-selection state (Set of user_ids)
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  // Selected student drawer/details
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [studentParticipations, setStudentParticipations] = useState<any[]>([]);
  const [loadingParticipations, setLoadingParticipations] = useState(false);

  // Export Modal States
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'FILTERED' | 'ENTIRE'>('FILTERED');
  const [exportFormat, setExportFormat] = useState<'EXCEL' | 'PNG'>('EXCEL');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Password Reset Modal State
  const [resetStudent, setResetStudent] = useState<{ id: string; email: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // Safe Bulk / Single Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    studentsToDelete: Array<{
      id: string;
      name: string;
      rollNumber: string;
      email: string;
      role?: string;
      isProtected?: boolean;
    }>;
  }>({ open: false, studentsToDelete: [] });
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  // Suspend Account Modal State
  const [suspendModal, setSuspendModal] = useState<{
    open: boolean;
    student: StudentProfile | null;
    reason: string;
    loading: boolean;
    error: string | null;
  }>({ open: false, student: null, reason: '', loading: false, error: null });

  // Unsuspend Account Modal State
  const [unsuspendModal, setUnsuspendModal] = useState<{
    open: boolean;
    student: StudentProfile | null;
    note: string;
    loading: boolean;
    error: string | null;
  }>({ open: false, student: null, note: '', loading: false, error: null });

  // Admin Edit Student Profile Modal State (with Strict 3-Edit Limit)
  const [editStudentModal, setEditStudentModal] = useState<{
    open: boolean;
    student: StudentProfile | null;
    fullName: string;
    rollNumber: string;
    department: string;
    otherDepartment: string;
    branch: string;
    yearOfStudy: number;
    college: string;
    phone: string;
    email: string;
    loading: boolean;
    error: string | null;
    success: string | null;
  }>({
    open: false,
    student: null,
    fullName: '',
    rollNumber: '',
    department: '',
    otherDepartment: '',
    branch: '',
    yearOfStudy: 1,
    college: '',
    phone: '',
    email: '',
    loading: false,
    error: null,
    success: null,
  });

  const handleOpenSuspend = (student: StudentProfile) => {
    setSuspendModal({
      open: true,
      student,
      reason: '',
      loading: false,
      error: null,
    });
  };

  const handleExecuteSuspend = async () => {
    if (!suspendModal.student) return;
    if (!suspendModal.reason.trim() || suspendModal.reason.trim().length < 3) {
      setSuspendModal(prev => ({ ...prev, error: 'A valid suspension reason (at least 3 characters) is required.' }));
      return;
    }

    setSuspendModal(prev => ({ ...prev, loading: true, error: null }));
    try {
      const { data, error } = await supabase.rpc('admin_suspend_student', {
        p_student_id: suspendModal.student.user_id,
        p_reason: suspendModal.reason.trim()
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to suspend student account.');
      }

      setSuspendModal({ open: false, student: null, reason: '', loading: false, error: null });
      await fetchStudents();
    } catch (err: any) {
      console.error('Failed to suspend student:', err);
      setSuspendModal(prev => ({ ...prev, loading: false, error: err.message || 'Failed to suspend account.' }));
    }
  };

  const handleOpenUnsuspend = (student: StudentProfile) => {
    setUnsuspendModal({
      open: true,
      student,
      note: '',
      loading: false,
      error: null,
    });
  };

  const handleExecuteUnsuspend = async () => {
    if (!unsuspendModal.student) return;

    setUnsuspendModal(prev => ({ ...prev, loading: true, error: null }));
    try {
      const { data, error } = await supabase.rpc('admin_unsuspend_student', {
        p_student_id: unsuspendModal.student.user_id,
        p_admin_note: unsuspendModal.note.trim() || null
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.message || 'Failed to unsuspend student account.');
      }

      setUnsuspendModal({ open: false, student: null, note: '', loading: false, error: null });
      await fetchStudents();
    } catch (err: any) {
      console.error('Failed to unsuspend student:', err);
      setUnsuspendModal(prev => ({ ...prev, loading: false, error: err.message || 'Failed to unsuspend account.' }));
    }
  };

  const handleOpenEditStudent = (student: StudentProfile) => {
    setEditStudentModal({
      open: true,
      student,
      fullName: student.full_name || '',
      rollNumber: student.roll_number || '',
      department: student.department || '',
      otherDepartment: student.other_department || '',
      branch: student.branch || '',
      yearOfStudy: Number(student.year_of_study) || 1,
      college: student.college || 'KITS Akshar Institute of Technology',
      phone: student.phone || '',
      email: (student as any).users?.email || '',
      loading: false,
      error: null,
      success: null,
    });
  };

  const handleCloseEditStudent = () => {
    setEditStudentModal(prev => ({
      ...prev,
      open: false,
      student: null,
      error: null,
      success: null,
      loading: false,
    }));
  };

  const handleExecuteEditStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editStudentModal.student) return;

    const currentEditCount = editStudentModal.student.admin_edit_count || 0;
    if (currentEditCount >= 3) {
      setEditStudentModal(prev => ({
        ...prev,
        error: 'Maximum 3 edits have already been used for this student account. Further edits are blocked.',
      }));
      return;
    }

    if (!editStudentModal.fullName.trim()) {
      setEditStudentModal(prev => ({ ...prev, error: 'Full legal name is required.' }));
      return;
    }
    if (!editStudentModal.rollNumber.trim()) {
      setEditStudentModal(prev => ({ ...prev, error: 'Roll number is required.' }));
      return;
    }
    if (!editStudentModal.department.trim()) {
      setEditStudentModal(prev => ({ ...prev, error: 'Department is required.' }));
      return;
    }
    if (editStudentModal.department === 'OTHER' && !editStudentModal.otherDepartment.trim()) {
      setEditStudentModal(prev => ({ ...prev, error: 'Please specify the department name for OTHER.' }));
      return;
    }
    if (!editStudentModal.college.trim()) {
      setEditStudentModal(prev => ({ ...prev, error: 'College is required.' }));
      return;
    }

    try {
      setEditStudentModal(prev => ({ ...prev, loading: true, error: null, success: null }));

      const { data, error: rpcErr } = await supabase.rpc('admin_edit_student_profile', {
        p_student_id: editStudentModal.student.user_id,
        p_full_name: editStudentModal.fullName.trim(),
        p_roll_number: editStudentModal.rollNumber.trim(),
        p_department: editStudentModal.department.trim(),
        p_year_of_study: Number(editStudentModal.yearOfStudy),
        p_college: editStudentModal.college.trim(),
        p_phone: editStudentModal.phone.trim(),
        p_branch: editStudentModal.branch.trim() || null,
        p_other_department: editStudentModal.department === 'OTHER' ? editStudentModal.otherDepartment.trim() : null,
        p_email: editStudentModal.email.trim() || null,
      });

      if (rpcErr) {
        throw rpcErr;
      }

      if (data && !data.success) {
        throw new Error(data.message || 'Failed to update student profile.');
      }

      const updatedStudent = data?.student;
      setEditStudentModal(prev => ({
        ...prev,
        loading: false,
        success: data?.message || 'Student profile successfully updated.',
      }));

      // Immediately reflect updated student information in Admin UI
      if (updatedStudent) {
        setStudents(prev => prev.map(s => {
          if (s.user_id === editStudentModal.student?.user_id) {
            return {
              ...s,
              full_name: updatedStudent.full_name,
              roll_number: updatedStudent.roll_number,
              department: updatedStudent.department,
              branch: updatedStudent.branch,
              other_department: updatedStudent.other_department,
              year_of_study: updatedStudent.year_of_study,
              college: updatedStudent.college,
              phone: updatedStudent.phone,
              admin_edit_count: updatedStudent.admin_edit_count,
              users: s.users ? { ...s.users, email: updatedStudent.email } : (s as any).users,
            };
          }
          return s;
        }));

        if (selectedStudent && selectedStudent.user_id === editStudentModal.student?.user_id) {
          setSelectedStudent(prev => prev ? ({
            ...prev,
            full_name: updatedStudent.full_name,
            roll_number: updatedStudent.roll_number,
            department: updatedStudent.department,
            branch: updatedStudent.branch,
            other_department: updatedStudent.other_department,
            year_of_study: updatedStudent.year_of_study,
            college: updatedStudent.college,
            phone: updatedStudent.phone,
            admin_edit_count: updatedStudent.admin_edit_count,
            users: prev.users ? { ...prev.users, email: updatedStudent.email } : (prev as any).users,
          }) : null);
        }
      }

      await fetchStudents();

      setTimeout(() => {
        handleCloseEditStudent();
      }, 1500);

    } catch (err: any) {
      console.error('Failed to edit student profile:', err);
      setEditStudentModal(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to update student details.',
      }));
    }
  };

  async function fetchStudents() {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchErr } = await supabase.rpc('admin_get_students_directory');

      if (fetchErr) throw fetchErr;

      const mappedStudents = ((data as any[]) || []).map((row: any) => ({
        user_id: row.user_id,
        full_name: row.full_name || '',
        roll_number: row.roll_number || '',
        college: row.college || '',
        department: row.department || '',
        other_department: row.other_department || null,
        branch: row.branch || null,
        year_of_study: row.year_of_study || 0,
        phone: row.phone || '',
        admin_edit_count: row.admin_edit_count || 0,
        account_status: row.account_status || (row.is_profile_complete ? 'ACTIVE' : 'INCOMPLETE'),
        suspension_reason: row.suspension_reason || null,
        suspended_at: row.suspended_at || null,
        suspended_by: row.suspended_by || null,
        is_profile_complete: row.is_profile_complete,
        users: {
          id: row.user_id,
          email: row.email,
          role: row.role,
          status: row.user_status,
          created_at: row.user_created_at,
        },
      }));

      setStudents(mappedStudents as unknown as StudentProfile[]);
    } catch (err: any) {
      console.error('Failed to load students directory:', err);
      setError(err.message || 'Failed to load students.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchStudents();
  }, []);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const user = (s as any).users;
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'INCOMPLETE') {
          if ((s as any).is_profile_complete !== false) return false;
        } else if (statusFilter === 'SUSPENDED') {
          if (s.account_status !== 'SUSPENDED') return false;
        } else if (statusFilter === 'ACTIVE') {
          if ((s as any).is_profile_complete === false || s.account_status === 'SUSPENDED' || user?.status !== 'ACTIVE') return false;
        } else if (user?.status !== statusFilter) {
          return false;
        }
      }
      if (deptFilter !== 'ALL' && s.department !== deptFilter) return false;
      if (yearFilter !== 'ALL' && String(s.year_of_study) !== yearFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = s.full_name?.toLowerCase().includes(q);
        const matchesRoll = s.roll_number?.toLowerCase().includes(q);
        const matchesEmail = user?.email?.toLowerCase().includes(q);
        const matchesPhone = s.phone?.toLowerCase().includes(q);
        const matchesCollege = s.college?.toLowerCase().includes(q);
        return matchesName || matchesRoll || matchesEmail || matchesPhone || matchesCollege;
      }

      return true;
    });
  }, [students, statusFilter, deptFilter, yearFilter, searchQuery]);

  // Pagination State (25 students per page)
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, deptFilter, yearFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / PAGE_SIZE));
  const paginatedStudents = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredStudents.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredStudents, currentPage]);

  // Selection helpers (scoped to visible paginated students)
  const allVisibleSelected = useMemo(() => {
    if (paginatedStudents.length === 0) return false;
    return paginatedStudents.every((s) => selectedStudentIds.has(s.user_id));
  }, [paginatedStudents, selectedStudentIds]);

  const someVisibleSelected = useMemo(() => {
    if (paginatedStudents.length === 0) return false;
    return paginatedStudents.some((s) => selectedStudentIds.has(s.user_id)) && !allVisibleSelected;
  }, [paginatedStudents, selectedStudentIds, allVisibleSelected]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      // Deselect visible
      setSelectedStudentIds((prev) => {
        const next = new Set(prev);
        paginatedStudents.forEach((s) => next.delete(s.user_id));
        return next;
      });
    } else {
      // Select all visible
      setSelectedStudentIds((prev) => {
        const next = new Set(prev);
        paginatedStudents.forEach((s) => next.add(s.user_id));
        return next;
      });
    }
  };

  const handleToggleSelectStudent = (userId: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectedStudentIds(new Set());
  };

  // Open Bulk Delete Dialog
  const handleOpenBulkDelete = () => {
    const list: Array<{
      id: string;
      name: string;
      rollNumber: string;
      email: string;
      role?: string;
      isProtected?: boolean;
    }> = [];

    students.forEach((s) => {
      if (selectedStudentIds.has(s.user_id)) {
        const cat = getAccountCategory(s);
        list.push({
          id: s.user_id,
          name: s.full_name || 'Unnamed Student',
          rollNumber: s.roll_number || 'N/A',
          email: (s as any).users?.email || 'N/A',
          role: cat.role,
          isProtected: !cat.isDeletable,
        });
      }
    });

    if (list.length === 0) return;

    setDeleteError(null);
    setDeleteSuccess(null);
    setDeleteModal({
      open: true,
      studentsToDelete: list,
    });
  };

  // Open Single Delete Dialog
  const handleOpenSingleDelete = (student: StudentProfile) => {
    const cat = getAccountCategory(student);
    setDeleteError(null);
    setDeleteSuccess(null);
    setDeleteModal({
      open: true,
      studentsToDelete: [{
        id: student.user_id,
        name: student.full_name || 'Unnamed Student',
        rollNumber: student.roll_number || 'N/A',
        email: (student as any).users?.email || 'N/A',
        role: cat.role,
        isProtected: !cat.isDeletable,
      }],
    });
  };

  // Execute Deletion via RPC with safe protection checks
  const handleExecuteDelete = async () => {
    if (deleteModal.studentsToDelete.length === 0) return;

    // Safety: prevent any execution if protected accounts are present
    const hasProtectedAccount = deleteModal.studentsToDelete.some((s) => s.isProtected || s.role !== 'STUDENT');
    if (hasProtectedAccount) {
      if (deleteModal.studentsToDelete.length === 1) {
        setDeleteError('This account has Administrator privileges and a linked Student profile. It cannot be deleted through Student Directory.');
      } else {
        setDeleteError('Some selected accounts cannot be deleted because they are protected Administrator or non-Student accounts.');
      }
      return;
    }

    try {
      setDeleteLoading(true);
      setDeleteError(null);

      const targetIds = deleteModal.studentsToDelete.map((s) => s.id);

      const { data, error: rpcErr } = await supabase.rpc('admin_bulk_delete_students', {
        p_student_ids: targetIds,
      });

      if (rpcErr) {
        const msg = (rpcErr && typeof rpcErr === 'object' && 'message' in rpcErr && typeof (rpcErr as any).message === 'string')
          ? (rpcErr as any).message
          : 'Failed to execute deletion.';
        setDeleteError(mapDeleteErrorMessage(msg, hasProtectedAccount));
        return;
      }

      const deletedCount = data?.deleted_count || 0;
      const failedCount = data?.failed_count || 0;

      if (deletedCount === 0 && failedCount > 0) {
        const rawReason = data?.failed_students?.[0]?.reason;
        setDeleteError(mapDeleteErrorMessage(rawReason, hasProtectedAccount));
        return;
      }

      if (failedCount > 0) {
        setDeleteError(`Some accounts could not be deleted: ${data?.failed_students?.map((f: any) => f.reason).join(', ')}`);
        return;
      }

      setDeleteSuccess(
        `Successfully deleted ${deletedCount} student account(s). All historical registrations, attendance, payments, and certificates remain safely preserved.`
      );

      // Close modal, clear selections, refresh live data
      setDeleteModal({ open: false, studentsToDelete: [] });
      setSelectedStudentIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });

      await fetchStudents();
    } catch (err: unknown) {
      const msg = (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string')
        ? (err as any).message
        : (typeof err === 'string' ? err : 'An unexpected error occurred while deleting accounts.');
      setDeleteError(mapDeleteErrorMessage(msg, hasProtectedAccount));
    } finally {
      setDeleteLoading(false);
    }
  };

  // Fetch Student Participations for Drawer
  const handleOpenStudentDrawer = async (student: StudentProfile) => {
    setSelectedStudent(student);
    setLoadingParticipations(true);

    try {
      const { data, error: regErr } = await supabase
        .from('team_members')
        .select(`
          id,
          is_leader,
          snapshot_name,
          snapshot_roll_number,
          teams (
            id,
            team_name,
            registrations (
              id,
              status,
              created_at,
              sub_events (
                id,
                name,
                events (name),
                categories (name)
              ),
              payments (status, amount)
            )
          )
        `)
        .eq('user_id', student.user_id);

      if (regErr) throw regErr;
      setStudentParticipations(data || []);
    } catch (err) {
      console.error('Failed to load participations:', err);
      setStudentParticipations([]);
    } finally {
      setLoadingParticipations(false);
    }
  };

  // Password Reset Modal Handlers
  const handleOpenPasswordReset = (student: StudentProfile) => {
    const user = (student as any).users;
    setResetStudent({
      id: student.user_id,
      email: user?.email || '',
      name: student.full_name || 'Student',
    });
    setResetMessage(null);
    setResetError(null);
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleClosePasswordReset = () => {
    setResetStudent(null);
    setResetMessage(null);
    setResetError(null);
    setNewPassword('');
    setConfirmPassword('');
  };

  // Password Reset Execution
  const handleExecutePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetStudent) return;

    if (newPassword.length < 6) {
      setResetError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    try {
      setResetLoading(true);
      setResetError(null);
      setResetMessage(null);

      const { data, error: fnErr } = await invokeAdminEdgeFunction('admin-reset-user-password', {
        body: {
          targetUserId: resetStudent.id,
          newPassword: newPassword,
        },
      });

      if (fnErr || (data && !data.success)) {
        let msg = 'Failed to reset password.';
        if (fnErr) {
          if (fnErr.context && typeof fnErr.context.json === 'function') {
            try {
              const body = await fnErr.context.json();
              if (body?.error?.message) msg = body.error.message;
              else if (body?.message) msg = body.message;
              else if (typeof body?.error === 'string') msg = body.error;
            } catch {
              msg = fnErr.message || msg;
            }
          } else {
            msg = fnErr.message || msg;
          }
        } else if (data?.error?.message) {
          msg = data.error.message;
        } else if (data?.message) {
          msg = data.message;
        } else if (typeof data?.error === 'string') {
          msg = data.error;
        }
        throw new Error(msg);
      }

      // If backend returned a fresh session (e.g. admin updated own credentials):
      // update client session immediately to keep admin active!
      if (data?.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }

      // Strictly set success ONLY when backend confirmed success
      setResetMessage(data?.message || `Password for ${resetStudent.name} (${resetStudent.email}) has been successfully updated.`);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Reset error:', err);
      setResetMessage(null);
      setResetError(err.message || 'Failed to update student password.');
    } finally {
      setResetLoading(false);
    }
  };

  // Export Directory
  const handleExecuteExport = async () => {
    try {
      setExportError(null);

      const dataset = exportScope === 'FILTERED' ? filteredStudents : students;

      if (dataset.length === 0) {
        throw new Error('No student records available for export.');
      }

      const headers = ['S.No', 'Full Name', 'Roll Number', 'Department', 'Year', 'Email', 'Mobile', 'College', 'Status', 'Registered At'];
      const rows = dataset.map((s, idx) => [
        idx + 1,
        s.full_name || 'N/A',
        s.roll_number || 'N/A',
        s.department === 'OTHER' ? s.other_department || 'Other' : s.department || 'N/A',
        s.year_of_study ? `Year ${s.year_of_study}` : 'N/A',
        (s as any).users?.email || 'N/A',
        s.phone || 'N/A',
        s.college || 'N/A',
        (s as any).users?.status || 'ACTIVE',
        (s as any).users?.created_at ? formatDateTime12h((s as any).users.created_at) : 'N/A',
      ]);

      if (exportFormat === 'EXCEL') {
        await exportToExcel({
          filename: `KITS_EOS_Student_Directory_${exportScope.toLowerCase()}_${new Date().toISOString().split('T')[0]}`,
          title: 'KITS-EOS Student Directory',
          subtitle: `Scope: ${exportScope} • Total: ${dataset.length}`,
          headers,
          rows,
        });
      } else {
        exportTableToPNG({
          filename: `KITS_EOS_Student_Directory_${new Date().toISOString().split('T')[0]}`,
          title: 'KITS-EOS Student Directory',
          headers,
          rows,
        });
      }

      setExportSuccess(`Exported ${dataset.length} student records successfully.`);
      setTimeout(() => {
        setIsExportModalOpen(false);
        setExportSuccess(null);
      }, 1800);
    } catch (err: any) {
      console.error('Export error:', err);
      setExportError(err.message || 'Export failed.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20 font-sans">
      <PageHeader
        title="Student Directory & Accounts"
        description="Search registered students, inspect historical event participations, reset credentials, and manage account lifecycle."
      />

      {/* Notifications */}
      {deleteSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{deleteSuccess}</span>
          </div>
          <button type="button" onClick={() => setDeleteSuccess(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-red-700 hover:text-red-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Top Filter and Actions Card */}
      <div className="bg-white p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="h-3.5 w-3.5 text-gray-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search by name, roll no, email, mobile, college..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-700 hover:text-kits-blue hover:border-blue-200 transition shadow-2xs cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-kits-blue" />
              <span>Export Directory</span>
            </button>
          </div>
        </div>

        {/* Filter Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100 text-xs">
          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">Department</label>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl font-medium"
            >
              <option value="ALL">All Departments</option>
              <option value="CSE">CSE</option>
              <option value="ECE">ECE</option>
              <option value="EEE">EEE</option>
              <option value="MECH">MECH</option>
              <option value="CIVIL">CIVIL</option>
              <option value="IT">IT</option>
              <option value="AI_DS">AI & DS</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">Year of Study</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl font-medium"
            >
              <option value="ALL">All Years</option>
              <option value="1">1st Year</option>
              <option value="2">2nd Year</option>
              <option value="3">3rd Year</option>
              <option value="4">4th Year</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1">Account Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl font-medium"
            >
              <option value="ALL">All Account Statuses</option>
              <option value="ACTIVE">Active Accounts</option>
              <option value="INCOMPLETE">Incomplete / Profile Pending</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
        </div>
      </div>

      {/* Floating Selection Bar */}
      {selectedStudentIds.size > 0 && (
        <div className="sticky top-4 z-30 p-3.5 bg-gray-900 text-white rounded-2xl shadow-xl border border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-0.5 rounded-full bg-kits-red text-white font-black text-[11px]">
              {selectedStudentIds.size}
            </span>
            <span className="font-bold">
              {selectedStudentIds.size === 1 ? '1 student account selected' : `${selectedStudentIds.size} student accounts selected`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDeselectAll}
              className="px-3 py-1.5 text-xs text-gray-300 hover:text-white font-bold transition cursor-pointer"
            >
              Deselect All
            </button>

            <button
              type="button"
              onClick={handleOpenBulkDelete}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-kits-red text-white text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-2xs cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete Selected</span>
            </button>
          </div>
        </div>
      )}

      {/* Students Table */}
      {isLoading ? (
        <LoadingState message="Loading registered student records..." />
      ) : filteredStudents.length === 0 ? (
        <EmptyState
          title="No Students Found"
          description="No student profiles match the filter and search parameters."
          icon={<Users className="h-10 w-10 text-gray-300" />}
        />
      ) : (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table id="admin-students-table" className="min-w-full divide-y divide-gray-200 text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px] font-extrabold tracking-wider">
                <tr>
                  <th scope="col" className="px-4 py-3.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      className="text-gray-500 hover:text-gray-900 transition cursor-pointer"
                      title={allVisibleSelected ? 'Deselect All' : 'Select All'}
                    >
                      {allVisibleSelected ? (
                        <CheckSquare className="h-4 w-4 text-kits-red" />
                      ) : someVisibleSelected ? (
                        <MinusSquare className="h-4 w-4 text-kits-red" />
                      ) : (
                        <Square className="h-4 w-4 text-gray-400" />
                      )}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3.5">Student Name</th>
                  <th scope="col" className="px-4 py-3.5">Roll Number</th>
                  <th scope="col" className="px-4 py-3.5">Department & Year</th>
                  <th scope="col" className="px-4 py-3.5">Email & Mobile</th>
                  <th scope="col" className="px-4 py-3.5">College</th>
                  <th scope="col" className="px-4 py-3.5">Status</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {paginatedStudents.map((s) => {
                  const isSelected = selectedStudentIds.has(s.user_id);
                  const user = (s as any).users;
                  const cat = getAccountCategory(s);
                  const deptDisplay = s.department === 'OTHER' ? s.other_department || 'Other' : s.department;

                  return (
                    <tr
                      key={s.user_id}
                      className={`hover:bg-gray-50/80 transition ${
                        isSelected ? 'bg-red-50/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleSelectStudent(s.user_id)}
                          className="text-gray-400 hover:text-gray-700 transition cursor-pointer"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4 w-4 text-kits-red" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </td>

                      <td className="px-4 py-3.5 font-bold text-gray-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenStudentDrawer(s)}
                          className="hover:text-kits-blue hover:underline text-left cursor-pointer"
                        >
                          {s.full_name || (
                            <span className="text-amber-700 italic font-medium flex items-center gap-1">
                              <AlertCircle className="h-3 w-3 text-amber-500 inline shrink-0" />
                              Profile Pending
                            </span>
                          )}
                        </button>
                      </td>

                      <td className="px-4 py-3.5 font-mono text-gray-700 whitespace-nowrap">
                        {s.roll_number || <span className="text-gray-400 italic font-sans">Pending</span>}
                      </td>

                      <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">
                        {s.department ? (
                          <>
                            <span className="font-semibold text-gray-800">{deptDisplay}{s.branch ? ` (${s.branch})` : ''}</span>{' '}
                            {s.year_of_study ? <span className="text-gray-500">• Yr {s.year_of_study}</span> : null}
                          </>
                        ) : (
                          <span className="text-gray-400 italic">Not Submitted</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap space-y-0.5">
                        <div className="flex items-center gap-1 font-mono text-[11px] text-gray-700">
                          <Mail className="h-3 w-3 text-gray-400" />
                          <span>{user?.email || '—'}</span>
                        </div>
                        {s.phone && (
                          <div className="flex items-center gap-1 font-mono text-[11px] text-gray-500">
                            <Phone className="h-3 w-3 text-gray-400" />
                            <span>{s.phone}</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-gray-600 truncate max-w-[150px]" title={s.college}>
                        {s.college || <span className="text-gray-400 italic">—</span>}
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          {cat.isDualAdmin ? (
                            <span 
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 w-fit shadow-2xs"
                              title={cat.tooltip}
                            >
                              <ShieldAlert className="h-3 w-3 text-amber-600 shrink-0" />
                              <span>ADMIN • STUDENT</span>
                            </span>
                          ) : cat.isCoordinator ? (
                            <span 
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-800 border border-blue-200 w-fit shadow-2xs"
                              title={cat.tooltip}
                            >
                              <span>COORDINATOR</span>
                            </span>
                          ) : null}

                          {(s as any).is_profile_complete === false ? (
                            <span 
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200 w-fit"
                              title="Account registered in Auth but student academic profile is pending completion"
                            >
                              <AlertCircle className="h-3 w-3 text-amber-600 shrink-0" />
                              <span>INCOMPLETE</span>
                            </span>
                          ) : s.account_status === 'SUSPENDED' ? (
                            <span 
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-50 text-kits-red border border-red-200 w-fit"
                              title={s.suspension_reason ? `Reason: ${s.suspension_reason}` : 'Account Suspended'}
                            >
                              <ShieldAlert className="h-3 w-3 text-kits-red shrink-0" />
                              <span>SUSPENDED</span>
                            </span>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                              user?.status === 'ACTIVE'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}>
                              {user?.status || 'ACTIVE'}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Suspend / Unsuspend Account Controls (Admin only, completed profiles only) */}
                          {cat.isDeletable && (s as any).is_profile_complete !== false && (
                            s.account_status === 'SUSPENDED' ? (
                              <button
                                type="button"
                                onClick={() => handleOpenUnsuspend(s)}
                                className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 transition cursor-pointer shadow-2xs"
                                title="Unsuspend and restore this student account"
                              >
                                Unsuspend
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenSuspend(s)}
                                className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg border border-red-300 text-kits-red bg-white hover:bg-red-50 transition cursor-pointer shadow-2xs"
                                title="Suspend this student account"
                              >
                                Suspend
                              </button>
                            )
                          )}

                          <button
                            type="button"
                            onClick={() => (s as any).is_profile_complete !== false && handleOpenEditStudent(s)}
                            disabled={(s as any).is_profile_complete === false}
                            className={`p-1.5 rounded-lg transition ${
                              (s as any).is_profile_complete === false
                                ? 'text-gray-300 cursor-not-allowed'
                                : (s.admin_edit_count || 0) >= 3
                                ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer'
                                : 'text-gray-500 hover:text-kits-blue hover:bg-blue-50 cursor-pointer'
                            }`}
                            title={
                              (s as any).is_profile_complete === false
                                ? 'Student profile has not yet been submitted by the student'
                                : (s.admin_edit_count || 0) >= 3
                                ? 'Edit Student Profile (3/3 edits used - Limit reached)'
                                : `Edit Student Profile (${Math.max(0, 3 - (s.admin_edit_count || 0))} edits remaining)`
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenStudentDrawer(s)}
                            className="p-1.5 text-gray-500 hover:text-kits-blue hover:bg-gray-100 rounded-lg transition cursor-pointer"
                            title="View Student Participations"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenPasswordReset(s)}
                            className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition cursor-pointer"
                            title="Reset Password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>

                          {cat.isDeletable ? (
                            <button
                              type="button"
                              onClick={() => handleOpenSingleDelete(s)}
                              className="p-1.5 text-gray-500 hover:text-kits-red hover:bg-red-50 rounded-lg transition cursor-pointer"
                              title="Delete Student Account"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="p-1.5 text-gray-300 cursor-not-allowed opacity-40 rounded-lg"
                              title={cat.tooltip}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination */}
          <div className="px-5 py-3.5 bg-gray-50/80 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-gray-900">{filteredStudents.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}</strong>–<strong className="text-gray-900">{Math.min(currentPage * PAGE_SIZE, filteredStudents.length)}</strong> of <strong className="text-gray-900">{filteredStudents.length}</strong> students
                {students.length !== filteredStudents.length && ` (filtered from ${students.length})`}
              </span>
              {selectedStudentIds.size > 0 && (
                <span className="ml-2 px-2 py-0.5 rounded-full bg-red-100 text-kits-red font-bold text-[10px]">
                  {selectedStudentIds.size} selected
                </span>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Prev</span>
                </button>

                <span className="px-3 py-1 font-mono font-bold text-gray-800 bg-white border border-gray-200 rounded-lg shadow-2xs">
                  {currentPage} / {totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer shadow-2xs"
                  title="Next page"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          SAFE BULK / SINGLE DELETE MODAL
          ========================================================================= */}
      {deleteModal.open && (() => {
        const hasProtectedAccount = deleteModal.studentsToDelete.some((s) => s.isProtected || s.role !== 'STUDENT');
        const isSingleProtected = deleteModal.studentsToDelete.length === 1 && hasProtectedAccount;
        const isBulkProtected = deleteModal.studentsToDelete.length > 1 && hasProtectedAccount;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-gray-200 relative modal-dialog-animate">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2.5">
                  {hasProtectedAccount ? (
                    <div className="p-2 rounded-xl bg-amber-100 text-amber-800">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                  ) : (
                    <div className="p-2 rounded-xl bg-red-100 text-kits-red">
                      <Trash2 className="h-5 w-5" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                      {isSingleProtected
                        ? 'Administrator Account Protected'
                        : isBulkProtected
                          ? 'Protected Accounts Detected'
                          : deleteModal.studentsToDelete.length === 1
                            ? 'Delete Student Account?'
                            : `Delete ${deleteModal.studentsToDelete.length} Student Accounts?`}
                    </h3>
                    <p className={`text-[11px] font-bold ${hasProtectedAccount ? 'text-amber-700' : 'text-gray-500'}`}>
                      {hasProtectedAccount ? 'Protected Account Security Enforcement' : 'High-Risk Administrative Operation'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteModal({ open: false, studentsToDelete: [] })}
                  className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {deleteError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              {/* Protected Notice Banner */}
              {isSingleProtected ? (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>Protected Administrator Account</span>
                  </div>
                  <p className="leading-relaxed">
                    This account has Administrator privileges and cannot be deleted through Student Directory.
                  </p>
                </div>
              ) : isBulkProtected ? (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-800">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>Action Blocked</span>
                  </div>
                  <p className="leading-relaxed">
                    Some selected accounts cannot be deleted because they are protected Administrator or non-Student accounts.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-600">
                  You are about to permanently remove the active student accounts for:
                </p>
              )}

              {/* List of affected students */}
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-2xl divide-y divide-gray-100 bg-gray-50 p-2 space-y-1">
                {deleteModal.studentsToDelete.map((s) => {
                  const isProt = s.isProtected || s.role !== 'STUDENT';
                  return (
                    <div 
                      key={s.id} 
                      className={`p-2 rounded-xl text-xs flex items-center justify-between gap-2 shadow-2xs ${
                        isProt ? 'bg-amber-50/70 border border-amber-200/80' : 'bg-white'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-gray-900 block">{s.name}</span>
                        <span className="text-[10px] text-gray-500 font-mono">Roll: {s.rollNumber} • {s.email}</span>
                      </div>
                      {isProt ? (
                        <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                          <ShieldAlert className="h-3 w-3 text-amber-600" />
                          <span>ADMIN • PROTECTED</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-black uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded-md shrink-0">
                          Student
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {!hasProtectedAccount && (
                <>
                  {/* Data retention assurance */}
                  <div className="p-3 bg-blue-50/80 border border-blue-200/80 rounded-2xl text-[11px] text-blue-950 font-medium space-y-1">
                    <span className="font-bold flex items-center gap-1 text-kits-blue">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Historical Record Preservation:
                    </span>
                    <p>
                      Active authentication and login profiles will be removed. All historical event registrations, team member snapshots, attendance records, payment histories, feedback responses, and issued certificates remain safely preserved in the database.
                    </p>
                  </div>

                  <p className="text-gray-500 text-[11px] font-bold">
                    ⚠️ This action cannot be undone.
                  </p>
                </>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                {hasProtectedAccount ? (
                  <button
                    type="button"
                    onClick={() => setDeleteModal({ open: false, studentsToDelete: [] })}
                    className="px-5 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-wider hover:bg-gray-800 transition shadow-2xs cursor-pointer"
                  >
                    Close
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setDeleteModal({ open: false, studentsToDelete: [] })}
                      className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <DeleteButton
                      disabled={deleteLoading}
                      loading={deleteLoading}
                      onClick={handleExecuteDelete}
                      className="px-6 py-2.5 rounded-xl"
                      label={deleteModal.studentsToDelete.length === 1 ? 'Yes, Delete Account' : `Yes, Delete ${deleteModal.studentsToDelete.length} Students`}
                      loadingLabel="Deleting Accounts..."
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* =========================================================================
          STUDENT DETAILS DRAWER
          ========================================================================= */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-end p-0 modal-overlay-animate">
          <div className="bg-white h-full max-w-md w-full p-6 space-y-6 shadow-2xl border-l border-gray-200 overflow-y-auto relative animate-slide-left">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Student Profile & History
                </h3>
                <p className="text-xs text-gray-500">Live Participations & Credentials</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudent(null)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Student Info Card */}
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">
                  {selectedStudent.full_name || (
                    <span className="text-amber-700 italic font-medium flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500 inline shrink-0" />
                      Profile Pending Completion
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs font-bold text-gray-600">
                  {selectedStudent.roll_number || <span className="text-gray-400 italic font-sans font-normal">Pending</span>}
                </span>
              </div>
              <div className="text-gray-600 space-y-1 text-[11px]">
                {(selectedStudent as any).is_profile_complete === false ? (
                  <div className="p-2 bg-amber-50/70 border border-amber-200/80 rounded-xl text-amber-900 text-[11px] space-y-0.5">
                    <span className="font-bold block text-amber-800">Account Onboarding Pending</span>
                    <span>Student has registered authentication credentials but has not submitted their official academic profile yet.</span>
                  </div>
                ) : (
                  <>
                    <div>
                      Dept: <strong className="text-gray-900">
                        {selectedStudent.department === 'OTHER' ? selectedStudent.other_department || 'Other' : selectedStudent.department}
                        {selectedStudent.branch ? ` (${selectedStudent.branch})` : ''} • Year {selectedStudent.year_of_study}
                      </strong>
                    </div>
                    <div>College: <strong className="text-gray-900">{selectedStudent.college}</strong></div>
                  </>
                )}
                <div>Email: <strong className="text-gray-900 font-mono">{(selectedStudent as any).users?.email || '—'}</strong></div>
                <div>Phone: <strong className="text-gray-900 font-mono">{selectedStudent.phone || '—'}</strong></div>

                {/* Remaining Admin Edits Badge */}
                <div className="pt-2 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-gray-500 font-bold uppercase text-[10px]">Admin Edits Remaining:</span>
                  <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-black uppercase tracking-wider border ${
                    (selectedStudent.admin_edit_count || 0) >= 3
                      ? 'bg-red-50 text-kits-red border-red-200'
                      : 'bg-blue-50 text-kits-blue border-blue-200'
                  }`}>
                    {Math.max(0, 3 - (selectedStudent.admin_edit_count || 0))} / 3 Left
                  </span>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => handleOpenEditStudent(selectedStudent)}
                    disabled={(selectedStudent as any).is_profile_complete === false}
                    className={`w-full py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs transition ${
                      (selectedStudent as any).is_profile_complete === false
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                        : 'bg-kits-blue text-white hover:bg-blue-800 cursor-pointer'
                    }`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>
                      {(selectedStudent as any).is_profile_complete === false
                        ? 'Profile Pending Completion'
                        : 'Edit Student Profile'}
                    </span>
                  </button>
                </div>

                {(selectedStudent as any).users?.role === 'ADMIN' && (
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-200">
                      <ShieldAlert className="h-3 w-3 text-amber-600 shrink-0" />
                      <span>ADMIN • STUDENT (Protected Account)</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Participations List */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-gray-900">
                Event Participations ({studentParticipations.length})
              </h4>

              {loadingParticipations ? (
                <LoadingState message="Loading participations..." />
              ) : studentParticipations.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400 border border-gray-100 rounded-2xl bg-gray-50">
                  No event participations recorded for this student yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {studentParticipations.map((p) => {
                    const team = p.teams;
                    const reg = team?.registrations;
                    const sub = reg?.sub_events;

                    return (
                      <div key={p.id} className="p-3 bg-white border border-gray-200 rounded-xl text-xs space-y-1 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-gray-900">{sub?.name || 'Sub-Event'}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            reg?.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {reg?.status || 'PENDING'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          Team: {team?.team_name || 'Solo'} • Role: {p.is_leader ? 'Leader' : 'Member'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          PASSWORD RESET MODAL
          ========================================================================= */}
      {resetStudent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-gray-200 relative modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-amber-600" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Reset Student Password
                </h3>
              </div>
              <button
                type="button"
                onClick={handleClosePasswordReset}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {resetError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                <span>{resetError}</span>
              </div>
            )}

            {resetMessage ? (
              <div className="text-center py-4 space-y-4">
                <div className="h-14 w-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-black text-gray-900">
                    Password Updated
                  </h4>
                  <p className="text-xs text-gray-600 leading-relaxed max-w-xs mx-auto">
                    {resetMessage}
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleClosePasswordReset}
                    className="w-full px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 transition shadow-2xs cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleExecutePasswordReset} className="space-y-4 text-xs">
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-1">
                  <span className="font-bold text-gray-900 block">{resetStudent.name}</span>
                  <span className="font-mono text-gray-600 text-[11px] block">{resetStudent.email}</span>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-700 block">New Password</label>
                  <PasswordInput
                    required
                    autoComplete="new-password"
                    placeholder="Min. 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-gray-700 block">Confirm Password</label>
                  <PasswordInput
                    required
                    autoComplete="new-password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue text-xs font-mono"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleClosePasswordReset}
                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="px-5 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-700 disabled:opacity-50 transition shadow-2xs cursor-pointer"
                  >
                    {resetLoading ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          EXPORT DIRECTORY MODAL
          ========================================================================= */}
      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-gray-200 relative modal-dialog-animate">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-kits-blue" />
                <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                  Export Student Directory
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {exportError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                <span>{exportError}</span>
              </div>
            )}

            {exportSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{exportSuccess}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-700 block">Dataset Scope</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportScope('FILTERED')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                      exportScope === 'FILTERED' ? 'border-kits-blue bg-blue-50/50 ring-1 ring-kits-blue font-bold text-kits-blue' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span>Filtered View</span>
                    <span className="text-[10px] text-gray-500 block font-normal">({filteredStudents.length} rows)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportScope('ENTIRE')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                      exportScope === 'ENTIRE' ? 'border-kits-blue bg-blue-50/50 ring-1 ring-kits-blue font-bold text-kits-blue' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span>Entire Directory</span>
                    <span className="text-[10px] text-gray-500 block font-normal">({students.length} rows)</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-700 block">Export Format</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExportFormat('EXCEL')}
                    className={`p-3 rounded-xl border flex items-center gap-2 cursor-pointer transition ${
                      exportFormat === 'EXCEL' ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600 font-bold text-emerald-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    <span>Excel (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('PNG')}
                    className={`p-3 rounded-xl border flex items-center gap-2 cursor-pointer transition ${
                      exportFormat === 'PNG' ? 'border-purple-600 bg-purple-50/50 ring-1 ring-purple-600 font-bold text-purple-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <ImageIcon className="h-4 w-4 text-purple-600" />
                    <span>Table PNG</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsExportModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
              >
                Cancel
              </button>
              <DownloadButton
                onDownload={handleExecuteExport}
                label="Download File"
                preparingLabel="Preparing Directory..."
                downloadingLabel={exportFormat === 'EXCEL' ? 'Generating Excel...' : 'Rendering PNG...'}
                completedLabel="Downloaded"
                variant="secondary"
                size="md"
              />
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SUSPEND CONFIRMATION MODAL
          ========================================================================= */}
      {suspendModal.open && suspendModal.student && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-red-200 shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-kits-red" />
                <h3 className="text-base font-black text-gray-900 tracking-tight">
                  Suspend Student Account
                </h3>
              </div>
              <button
                type="button"
                disabled={suspendModal.loading}
                onClick={() => setSuspendModal({ open: false, student: null, reason: '', loading: false, error: null })}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {suspendModal.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{suspendModal.error}</span>
              </div>
            )}

            {/* Student Context Display */}
            <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Student</span>
                  <span className="font-bold text-gray-800 truncate block">
                    {suspendModal.student.full_name}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Roll Number</span>
                  <span className="font-mono font-bold text-gray-800 block">
                    {suspendModal.student.roll_number || '—'}
                  </span>
                </div>
              </div>
              <div className="pt-1 border-t border-gray-200/60 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-gray-400">Current Status</span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ACTIVE
                </span>
              </div>
            </div>

            {/* Reason Textarea */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Reason for suspension <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={suspendModal.reason}
                onChange={(e) => setSuspendModal(prev => ({ ...prev, reason: e.target.value }))}
                placeholder="Provide the reason for suspending this EOS account. This reason will be shown to the student."
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-kits-red focus:border-kits-red resize-none transition"
                maxLength={500}
                autoFocus
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Provide the reason for suspending this EOS account. This reason will be shown to the student.
              </p>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={suspendModal.loading}
                onClick={() => setSuspendModal({ open: false, student: null, reason: '', loading: false, error: null })}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={suspendModal.loading || suspendModal.reason.trim().length < 3}
                onClick={handleExecuteSuspend}
                className="px-5 py-2.5 rounded-xl bg-white border-2 border-kits-red text-kits-red text-xs font-black uppercase tracking-wider hover:bg-red-50 transition flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                <ShieldAlert className={`h-3.5 w-3.5 ${suspendModal.loading ? 'animate-spin' : ''}`} />
                <span>{suspendModal.loading ? 'Suspending...' : 'Suspend Account'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          UNSUSPEND CONFIRMATION MODAL
          ========================================================================= */}
      {unsuspendModal.open && unsuspendModal.student && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-emerald-200 shadow-2xl max-w-md w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-black text-gray-900 tracking-tight">
                  Unsuspend Student Account
                </h3>
              </div>
              <button
                type="button"
                disabled={unsuspendModal.loading}
                onClick={() => setUnsuspendModal({ open: false, student: null, note: '', loading: false, error: null })}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {unsuspendModal.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{unsuspendModal.error}</span>
              </div>
            )}

            <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Student</span>
                  <span className="font-bold text-gray-800 truncate block">
                    {unsuspendModal.student.full_name}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Roll Number</span>
                  <span className="font-mono font-bold text-gray-800 block">
                    {unsuspendModal.student.roll_number || '—'}
                  </span>
                </div>
              </div>
              {unsuspendModal.student.suspension_reason && (
                <div className="pt-1 border-t border-gray-200/60">
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Previous Suspension Reason</span>
                  <span className="font-medium text-gray-700 text-[11px] block italic">
                    "{unsuspendModal.student.suspension_reason}"
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-600">
              Are you sure you want to restore this account? The student will immediately regain normal access to the KITS-EOS portal, event registration, and credentials.
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Admin Note / Resolution Comment (Optional)
              </label>
              <textarea
                rows={2}
                value={unsuspendModal.note}
                onChange={(e) => setUnsuspendModal(prev => ({ ...prev, note: e.target.value }))}
                placeholder="e.g. Account reinstated after administrative review."
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-xs text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none transition"
                maxLength={300}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                disabled={unsuspendModal.loading}
                onClick={() => setUnsuspendModal({ open: false, student: null, note: '', loading: false, error: null })}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={unsuspendModal.loading}
                onClick={handleExecuteUnsuspend}
                className="px-5 py-2.5 rounded-xl bg-white border-2 border-emerald-600 text-emerald-700 text-xs font-black uppercase tracking-wider hover:bg-emerald-50 transition flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                <CheckCircle2 className={`h-3.5 w-3.5 ${unsuspendModal.loading ? 'animate-spin' : ''}`} />
                <span>{unsuspendModal.loading ? 'Unsuspending...' : 'Unsuspend Account'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ADMIN EDIT STUDENT PROFILE MODAL (WITH STRICT 3-EDIT LIMIT)
          ========================================================================= */}
      {editStudentModal.open && editStudentModal.student && (() => {
        const editCount = editStudentModal.student.admin_edit_count || 0;
        const remainingEdits = Math.max(0, 3 - editCount);
        const isLimitReached = editCount >= 3;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto modal-overlay-animate">
            <div className="bg-white rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-gray-200 relative modal-dialog-animate">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`p-2 rounded-xl ${isLimitReached ? 'bg-red-100 text-kits-red' : 'bg-blue-100 text-kits-blue'}`}>
                    <Pencil className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                      Edit Student Details (Admin)
                    </h3>
                    <p className="text-[11px] font-bold text-gray-500">
                      Authoritative Profile Management
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                    isLimitReached 
                      ? 'bg-red-50 text-kits-red border-red-200' 
                      : 'bg-blue-50 text-kits-blue border-blue-200'
                  }`}>
                    {isLimitReached ? '0 Edits Remaining' : `${remainingEdits} of 3 Edits Left`}
                  </span>

                  <button
                    type="button"
                    onClick={handleCloseEditStudent}
                    className="p-1 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-700 transition cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Error & Success Banners */}
              {editStudentModal.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-bold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-kits-red shrink-0" />
                  <span className="break-words">{editStudentModal.error}</span>
                </div>
              )}

              {editStudentModal.success && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-bold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{editStudentModal.success}</span>
                </div>
              )}

              {/* 3-Edit Limit Warning / Notice Banner */}
              {isLimitReached ? (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-kits-red">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span>Maximum 3 Edits Reached</span>
                  </div>
                  <p className="leading-relaxed text-[11px]">
                    This student profile has already been edited <strong>3 times</strong> by Administrators. Under KITS-EOS administrative governance rules, no further modifications are permitted for this account.
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-blue-50/80 border border-blue-200/80 rounded-2xl text-[11px] text-blue-950 font-medium space-y-0.5">
                  <span className="font-bold flex items-center gap-1 text-kits-blue">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Administrative 3-Edit Limit Policy:
                  </span>
                  <p>
                    Each student account allows a maximum of 3 administrative profile edits across the entire system. Saving changes now will consume edit #{editCount + 1} ({remainingEdits - 1} remaining after this save).
                  </p>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleExecuteEditStudent} className="space-y-3.5 text-xs">
                {/* Name & Roll Number */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Full Legal Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.fullName}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, fullName: e.target.value }))}
                      placeholder="e.g. John Doe"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Roll Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.rollNumber}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, rollNumber: e.target.value.toUpperCase() }))}
                      placeholder="e.g. 23KH1A0501"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Department & Branch */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Department <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.department}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, department: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
                    >
                      <option value="" disabled>Select Department</option>
                      {DEPARTMENTS.map((dept) => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Branch / Specialization
                    </label>
                    <input
                      type="text"
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.branch}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, branch: e.target.value }))}
                      placeholder="e.g. CSE, AIML, ECE"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
                    />
                  </div>
                </div>

                {/* Other Department Specification if 'OTHER' */}
                {editStudentModal.department === 'OTHER' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Specify Other Department <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.otherDepartment}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, otherDepartment: e.target.value }))}
                      placeholder="Enter exact academic department name"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
                    />
                  </div>
                )}

                {/* Year of Study & College */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Year of Study <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.yearOfStudy}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, yearOfStudy: Number(e.target.value) }))}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
                    >
                      <option value={1}>1st Year</option>
                      <option value={2}>2nd Year</option>
                      <option value={3}>3rd Year</option>
                      <option value={4}>4th Year</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      College / Institution <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.college}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, college: e.target.value }))}
                      placeholder="e.g. KITS Akshar Institute of Technology"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-semibold"
                    />
                  </div>
                </div>

                {/* Mobile Phone & Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Mobile Number <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      required
                      maxLength={15}
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.phone}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="10-digit mobile number"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-700 block">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      disabled={isLimitReached || editStudentModal.loading}
                      value={editStudentModal.email}
                      onChange={(e) => setEditStudentModal(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="student@example.com"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-kits-blue focus:ring-1 focus:ring-kits-blue disabled:opacity-50 disabled:cursor-not-allowed text-xs font-mono font-semibold"
                    />
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleCloseEditStudent}
                    className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={isLimitReached || editStudentModal.loading}
                    className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition shadow-2xs cursor-pointer flex items-center gap-1.5 ${
                      isLimitReached
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-kits-blue text-white hover:bg-blue-800 disabled:opacity-50'
                    }`}
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>
                      {editStudentModal.loading 
                        ? 'Saving Changes...' 
                        : isLimitReached 
                          ? '3 Edits Used (Locked)' 
                          : `Save Changes (${remainingEdits} edit${remainingEdits === 1 ? '' : 's'} left)`}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
