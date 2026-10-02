import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsQR from 'jsqr';
import { supabase } from '@kits-eos/shared/src/api/client';
import { getCoordinatorAuthHeaders, getCoordinatorSessionToken } from '../../utils/coordinatorSession';
import { 
  Camera, 
  Upload, 
  KeyRound, 
  CheckCircle2, 
  AlertCircle, 
  AlertTriangle, 
  X, 
  Users, 
  Clock, 
  RefreshCw, 
  CameraOff,
  CheckSquare,
  Square,
  UserCheck
} from 'lucide-react';

interface Props {
  subEventId: string;
  subEventName?: string;
  coordinatorId?: string;
  onAttendanceRecorded: () => void;
}

export interface VerificationAlert {
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  code?: string;
}

export function AttendanceVerificationHub({ subEventId, subEventName, coordinatorId, onAttendanceRecorded }: Props) {
  // Manual token 10-digit input state
  const [manualTokenDigits, setManualTokenDigits] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [businessAlert, setBusinessAlert] = useState<VerificationAlert | null>(null);

  // Dynamic canonical prefix helper derived from live subEventName
  const getCanonicalPrefix = (name?: string) => {
    const cleanCode = (name || 'EVENT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `KITS-EOS-${cleanCode}-`;
  };

  // Participant Preview State (SCAN ≠ CHECK-IN)
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null);

  // Team Attendance Individual Selection State
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

  // Camera Scanner State (Continuous Mode)
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannerStatus, setScannerStatus] = useState<'IDLE' | 'ACTIVE' | 'PROCESSING' | 'SUCCESS'>('IDLE');
  const [lastConfirmedStudent, setLastConfirmedStudent] = useState<{ name: string; rollNumber: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const isProcessingScanRef = useRef<boolean>(false);
  const lastScannedCodeRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const resetSuccessTimerRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // File Upload State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDecodingFile, setIsDecodingFile] = useState(false);

  // Clean up and reset when sub-event changes
  useEffect(() => {
    setPreviewData(null);
    setCommitSuccess(null);
    setBusinessAlert(null);
    setManualTokenDigits('');
    setLastConfirmedStudent(null);
    setSelectedMemberIds(new Set());
    stopCamera();
  }, [subEventId]);

  // Synchronize team member selection when previewData changes
  useEffect(() => {
    if (!previewData) {
      setSelectedMemberIds(new Set());
      return;
    }

    const isTeam = previewData.team && (previewData.team.is_team || previewData.registration?.participation_type === 'TEAM');
    if (isTeam && Array.isArray(previewData.team.members)) {
      // By default, select all pending members who haven't attended yet
      const pendingIds = previewData.team.members
        .filter((m: any) => !m.is_attended)
        .map((m: any) => m.id);
      setSelectedMemberIds(new Set(pendingIds));
    } else {
      setSelectedMemberIds(new Set());
    }
  }, [previewData]);

  // Clean up camera and pending requests on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (resetSuccessTimerRef.current) {
        clearTimeout(resetSuccessTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // -------------------------------------------------------------
  // Verification Call to Edge Function (Resolve & Preview)
  // -------------------------------------------------------------
  const verifyParticipantQuery = async (queryStr: string, isFromCamera = false) => {
    if (!queryStr.trim() || !subEventId) {
      if (isFromCamera) {
        isProcessingScanRef.current = false;
        setScannerStatus('ACTIVE');
      }
      return;
    }

    const clean = queryStr.trim();
    let modalOpened = false;

    try {
      setIsVerifying(true);
      setBusinessAlert(null);
      setCommitSuccess(null);
      setPreviewData(null);

      // Abort any prior in-flight verification request to prevent race conditions
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
      const isTenDigits = /^\d{10}$/.test(clean);
      const isCanonicalToken = /^KITS-EOS-[A-Z0-9-]+-\d{10}$/i.test(clean);
      const isRollNumber = /^[0-9]{2}[A-Z0-9]{8,10}$/i.test(clean);

      // Pre-check obviously invalid pass format
      if (!isUuid && !isTenDigits && !isCanonicalToken && !isRollNumber && !clean.toUpperCase().startsWith('KITS-EOS-')) {
        setBusinessAlert({
          type: 'error',
          title: '❌ INVALID QR',
          message: 'Invalid KITS-EOS QR code. No attendance marked.',
          code: 'INVALID_QR'
        });
        return;
      }

      // Pre-check coordinator session validity if in coordinator mode
      const coordToken = getCoordinatorSessionToken();
      if (coordinatorId && !coordToken) {
        setBusinessAlert({
          type: 'error',
          title: 'Session Expired',
          message: 'Your coordinator session is no longer valid. Please sign in again.',
          code: 'AUTH_SESSION_INVALID'
        });
        if (isFromCamera) {
          isProcessingScanRef.current = false;
          setScannerStatus('ACTIVE');
        }
        return;
      }

      // Proactively ensure fresh auth session for Admin scans
      if (!coordToken) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session && session.expires_at) {
            const msRemaining = session.expires_at * 1000 - Date.now();
            if (msRemaining < 60000) {
              await supabase.auth.refreshSession();
            }
          }
        } catch {
          // non-fatal
        }
      }

      // 1. Primary path: Call atomic PostgreSQL RPC directly (<5ms response, zero GoTrue rate limits)
      let payload: any = null;
      let rpcFailed = false;

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('verify_attendance_participant', {
          p_sub_event_id: subEventId,
          p_query: clean,
          p_coordinator_token: coordToken || null
        });

        if (!rpcError && rpcData) {
          payload = rpcData;
        } else {
          rpcFailed = true;
        }
      } catch {
        rpcFailed = true;
      }

      // 2. Fallback path: Call Edge Function if RPC call encountered issues
      if (rpcFailed || !payload) {
        const authHeaders = getCoordinatorAuthHeaders();
        const { data: edgeData, error: edgeError } = await supabase.functions.invoke('coordinator-verify-participant', {
          headers: authHeaders,
          body: {
            coordinator_id: coordinatorId || null,
            sub_event_id: subEventId,
            query: clean
          }
        });

        payload = edgeData;
        if (edgeError && (edgeError as any).context) {
          try {
            payload = await (edgeError as any).context.json();
          } catch {
            // ignore
          }
        }

        if (edgeError && !payload) {
          throw edgeError;
        }
      }

      // 3. Process Authoritative Result Payload
      const code = payload?.code || payload?.error?.code;
      const msg = payload?.message || payload?.error?.message;
      const partName = payload?.participant?.name;
      const actualSub = payload?.participant?.actual_sub_event_name;

      if (payload && payload.success === true && payload.participant) {
        const isTeam = Boolean(
          payload.team && (payload.team.is_team || payload.registration?.participation_type === 'TEAM')
        );
        const teamMembers = payload.team?.members || [];
        const allTeamAttended = isTeam && teamMembers.length > 0 && teamMembers.every((m: any) => m.is_attended);

        if (isTeam && allTeamAttended) {
          setBusinessAlert({
            type: 'warning',
            title: '✓ ALL ATTENDED',
            message: 'All members of this team have already been marked as attended.',
            code: 'ALREADY_ATTENDED'
          });
          setPreviewData(payload);
          modalOpened = true;
          return;
        }

        if (!isTeam && payload.attendance?.is_attended) {
          setBusinessAlert({
            type: 'warning',
            title: '✓ ALREADY MARKED',
            message: `Attendance has already been marked for ${partName || 'this student'}.`,
            code: 'ALREADY_ATTENDED'
          });
          setPreviewData(payload);
          modalOpened = true;
          return;
        }

        // Ready for attendance confirmation
        setPreviewData(payload);
        modalOpened = true;
        return;
      }

      // 4. Structured Business Error Cases
      if (code === 'ALREADY_ATTENDED') {
        setBusinessAlert({
          type: 'warning',
          title: '✓ ALREADY MARKED',
          message: msg || 'Attendance has already been marked for this student.',
          code: 'ALREADY_ATTENDED'
        });
        if (payload?.participant) {
          setPreviewData(payload);
          modalOpened = true;
        }
      } else if (code === 'INVALID_QR' || code === 'WRONG_QR_TYPE') {
        setBusinessAlert({
          type: 'error',
          title: '❌ INVALID QR',
          message: 'Invalid KITS-EOS QR code. No attendance marked.',
          code: 'INVALID_QR'
        });
      } else if (code === 'EVENT_MISMATCH' || code === 'PARTICIPANT_NOT_IN_EVENT') {
        setBusinessAlert({
          type: 'warning',
          title: '⚠️ WRONG EVENT / SUB-EVENT',
          message: msg || (partName ? `${partName} belongs to ${actualSub || 'another sub-event'}. No attendance marked.` : 'This QR belongs to another event/sub-event. No attendance marked.'),
          code: 'EVENT_MISMATCH'
        });
      } else if (code === 'PAYMENT_PENDING') {
        setBusinessAlert({
          type: 'warning',
          title: '⚠️ PAYMENT PENDING',
          message: msg || 'Attendance cannot be confirmed until payment is verified.',
          code: 'PAYMENT_PENDING'
        });
      } else if (code === 'AMBIGUOUS_TOKEN') {
        setBusinessAlert({
          type: 'error',
          title: 'Ambiguous Token',
          message: 'This attendance token could not be uniquely verified. No attendance marked.',
          code: 'AMBIGUOUS_TOKEN'
        });
      } else if (code === 'NOT_REGISTERED' || code === 'PARTICIPANT_NOT_FOUND') {
        setBusinessAlert({
          type: 'error',
          title: 'Participant Not Registered',
          message: msg || 'Participant is not registered for this sub-event. No attendance marked.',
          code: 'NOT_REGISTERED'
        });
      } else if (code === 'INVALID_TOKEN') {
        setBusinessAlert({
          type: 'error',
          title: 'Invalid Attendance Token',
          message: 'Invalid attendance token. No attendance marked.',
          code: 'INVALID_TOKEN'
        });
      } else if (code === 'AUTH_SESSION_INVALID') {
        setBusinessAlert({
          type: 'error',
          title: 'Session Expired',
          message: msg || 'Your coordinator session is no longer valid. Please sign in again.',
          code: 'AUTH_SESSION_INVALID'
        });
      } else if (code === 'NOT_ASSIGNED_TO_SUB_EVENT') {
        setBusinessAlert({
          type: 'error',
          title: 'Not Assigned',
          message: msg || 'You are not assigned to this sub-event.',
          code: 'NOT_ASSIGNED_TO_SUB_EVENT'
        });
      } else if (code === 'SUB_EVENT_INACTIVE') {
        setBusinessAlert({
          type: 'warning',
          title: 'Sub-Event Inactive',
          message: msg || 'Attendance is currently unavailable for this sub-event.',
          code: 'SUB_EVENT_INACTIVE'
        });
      } else if (code === 'PARTICIPANT_NOT_FOUND' || code === 'NOT_REGISTERED') {
        setBusinessAlert({
          type: 'error',
          title: 'Participant Not Found',
          message: msg || 'The QR code could not be matched to a participant.',
          code: 'PARTICIPANT_NOT_FOUND'
        });
      } else if (code === 'UNAUTHORIZED_COORDINATOR' || code === 'FORBIDDEN') {
        setBusinessAlert({
          type: 'error',
          title: 'Unauthorized Operation',
          message: msg || 'You are not authorized to verify attendance for this sub-event.',
          code: 'UNAUTHORIZED_COORDINATOR'
        });
      } else if (code === 'REGISTRATION_INVALID') {
        setBusinessAlert({
          type: 'error',
          title: 'Registration Invalid',
          message: msg || 'Registration could not be verified. No attendance marked.',
          code: 'REGISTRATION_INVALID'
        });
      } else {
        setBusinessAlert({
          type: 'error',
          title: 'Verification Error',
          message: msg || 'Attendance verification encountered a temporary technical issue. Please try scanning again.',
          code: code || 'SERVER_ERROR'
        });
      }

    } catch (err: any) {
      modalOpened = false;
      if (err?.name === 'AbortError') {
        return;
      }
      console.error('[AttendanceVerification] Unexpected verification exception:', {
        error: err,
        query: clean,
        subEventId,
        isFromCamera,
        timestamp: new Date().toISOString()
      });

      const isNetworkError = !navigator.onLine || err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError');
      setBusinessAlert({
        type: 'error',
        title: isNetworkError ? 'Network Interruption' : 'Verification Error',
        message: isNetworkError
          ? 'Unable to connect to verification server. Please check your network connection.'
          : 'Attendance verification encountered a temporary technical issue. Please try scanning again.',
        code: 'NETWORK_OR_SERVER_ERROR'
      });
      setPreviewData(null);
    } finally {
      setIsVerifying(false);
      // Guaranteed scanner lock cleanup:
      // If modal did not open, safely release the camera processing lock after brief buffer
      if (isFromCamera && !modalOpened) {
        setTimeout(() => {
          isProcessingScanRef.current = false;
          setScannerStatus('ACTIVE');
        }, 400);
      }
    }
  };

  // -------------------------------------------------------------
  // Camera Video Scanner Implementation (Continuous Mode)
  // -------------------------------------------------------------
  const startCamera = async () => {
    setCameraError(null);
    setBusinessAlert(null);
    setPreviewData(null);
    isProcessingScanRef.current = false;
    lastScannedCodeRef.current = null;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      mediaStreamRef.current = stream;
      setCameraActive(true);
      setScannerStatus('ACTIVE');

      // Wait a tick for video element to mount
      setTimeout(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          try {
            await videoRef.current.play();
            animFrameIdRef.current = requestAnimationFrame(scanFrame);
          } catch (e: any) {
            console.error('Video play error:', e);
          }
        }
      }, 100);

    } catch (err: any) {
      console.error('Camera start error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera permissions in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera device was detected on your system.');
      } else {
        setCameraError(err.message || 'Unable to access camera.');
      }
      setCameraActive(false);
      setScannerStatus('IDLE');
    }
  };

  const stopCamera = () => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setScannerStatus('IDLE');
    isProcessingScanRef.current = false;
    lastScannedCodeRef.current = null;
  };

  const scanFrame = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      animFrameIdRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    // If a scan is currently being processed or preview modal is open, continue frame loop without re-triggering
    if (isProcessingScanRef.current) {
      animFrameIdRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code && code.data) {
        const rawCode = code.data.trim();
        const now = Date.now();

        // Prevent duplicate spam if the same physical card is held in front of the lens
        if (rawCode === lastScannedCodeRef.current && now - lastScannedTimeRef.current < 2500) {
          animFrameIdRef.current = requestAnimationFrame(scanFrame);
          return;
        }

        // QR Code detected! LOCK PROCESSING but DO NOT STOP CAMERA!
        isProcessingScanRef.current = true;
        lastScannedCodeRef.current = rawCode;
        lastScannedTimeRef.current = now;
        setScannerStatus('PROCESSING');
        verifyParticipantQuery(rawCode, true);
      }
    }

    animFrameIdRef.current = requestAnimationFrame(scanFrame);
  }, [subEventId, coordinatorId]);

  // -------------------------------------------------------------
  // File Upload QR Decoder
  // -------------------------------------------------------------
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsDecodingFile(true);
    setBusinessAlert(null);
    setPreviewData(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;

        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);

          if (code && code.data) {
            setIsDecodingFile(false);
            verifyParticipantQuery(code.data, false);
          } else {
            setIsDecodingFile(false);
            setBusinessAlert({
              type: 'error',
              title: '❌ INVALID QR',
              message: 'Invalid KITS-EOS QR code. No attendance marked.',
              code: 'INVALID_QR'
            });
          }
        } else {
          setIsDecodingFile(false);
          setBusinessAlert({
            type: 'error',
            title: '❌ INVALID QR',
            message: 'Invalid KITS-EOS QR code. No attendance marked.',
            code: 'INVALID_QR'
          });
        }
      };
      img.onerror = () => {
        setIsDecodingFile(false);
        setBusinessAlert({
          type: 'error',
          title: '❌ INVALID QR',
          message: 'Invalid KITS-EOS QR code. No attendance marked.',
          code: 'INVALID_QR'
        });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // -------------------------------------------------------------
  // Manual Verification Submit
  // -------------------------------------------------------------
  const handleDigitsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only accept numeric digits, up to 10 chars
    const numericOnly = e.target.value.replace(/\D/g, '').slice(0, 10);
    setManualTokenDigits(numericOnly);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = manualTokenDigits.trim();
    if (digits.length !== 10 || !/^\d{10}$/.test(digits)) return;
    const prefix = getCanonicalPrefix(subEventName);
    const fullCanonicalToken = `${prefix}${digits}`;
    verifyParticipantQuery(fullCanonicalToken, false);
  };

  // -------------------------------------------------------------
  // Team Member Attendance Selection Helpers
  // -------------------------------------------------------------
  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  };

  const handleSelectAllMembers = () => {
    if (!previewData?.team?.members) return;
    const pendingIds = previewData.team.members
      .filter((m: any) => !m.is_attended)
      .map((m: any) => m.id);
    setSelectedMemberIds(new Set(pendingIds));
  };

  const handleDeselectAllMembers = () => {
    setSelectedMemberIds(new Set());
  };

  // -------------------------------------------------------------
  // Confirm Attendance Commit (Team Selection or Solo Participant)
  // -------------------------------------------------------------
  const handleConfirmAttendance = async () => {
    if (!previewData || !subEventId || isCommitting) return;

    const isTeam = Boolean(
      previewData.team && (previewData.team.is_team || previewData.registration?.participation_type === 'TEAM')
    );

    if (isTeam && selectedMemberIds.size === 0) {
      setBusinessAlert({
        type: 'warning',
        title: 'No Members Selected',
        message: 'Please select at least one team member to record attendance.'
      });
      return;
    }

    try {
      setIsCommitting(true);
      setBusinessAlert(null);

      const coordToken = getCoordinatorSessionToken();
      if (coordinatorId && !coordToken) {
        setBusinessAlert({
          type: 'error',
          title: 'Session Expired',
          message: 'Your coordinator session is no longer valid. Please sign in again.',
          code: 'AUTH_SESSION_INVALID'
        });
        setIsCommitting(false);
        return;
      }

      const memberIds = isTeam ? Array.from(selectedMemberIds) : [previewData.participant.id];
      const targetTeamId = previewData.team.id;

      // 1. Primary path: Call atomic PostgreSQL RPC commit_attendance_checkin (<5ms ACID transaction)
      let payload: any = null;
      let rpcFailed = false;

      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('commit_attendance_checkin', {
          p_sub_event_id: subEventId,
          p_team_id: targetTeamId,
          p_scanned_member_ids: memberIds,
          p_coordinator_token: coordToken || null
        });

        if (!rpcError && rpcData) {
          payload = rpcData;
        } else {
          rpcFailed = true;
        }
      } catch {
        rpcFailed = true;
      }

      // 2. Fallback path: Call Edge Function if RPC call encountered issues
      if (rpcFailed || !payload) {
        const authHeaders = getCoordinatorAuthHeaders();
        let bodyPayload: any;
        if (isTeam) {
          bodyPayload = {
            coordinator_id: coordinatorId || null,
            sub_event_id: subEventId,
            team_id: targetTeamId,
            scanned_member_ids: memberIds
          };
        } else {
          bodyPayload = {
            coordinator_id: coordinatorId || null,
            sub_event_id: subEventId,
            team_id: targetTeamId,
            scanned_member_id: previewData.participant.id
          };
        }

        const { data: edgeData, error: edgeError } = await supabase.functions.invoke('coordinator-checkin', {
          headers: authHeaders,
          body: bodyPayload
        });

        payload = edgeData;
        if (edgeError && (edgeError as any).context) {
          try {
            payload = await (edgeError as any).context.json();
          } catch {
            // ignore
          }
        }

        if (edgeError && !payload) {
          throw edgeError;
        }
      }

      if (!payload?.success) {
        const errorMsg = payload?.error?.message || payload?.message;
        setBusinessAlert({
          type: 'error',
          title: 'Attendance Check-in Failed',
          message: errorMsg || 'Attendance check-in could not be confirmed. Please try again.'
        });
        return;
      }

      if (isTeam) {
        const recordedCount = payload.recorded_count ?? selectedMemberIds.size;
        const teamName = previewData.team.team_name || 'Team';
        setLastConfirmedStudent({
          name: teamName,
          rollNumber: `${recordedCount} member(s)`
        });

        setCommitSuccess(
          `Attendance Confirmed! ${recordedCount} team member(s) from "${teamName}" marked as ATTENDED.`
        );
      } else {
        const participantName = previewData.participant.name;
        const rollNum = previewData.participant.roll_number;

        setLastConfirmedStudent({
          name: participantName,
          rollNumber: rollNum
        });

        setCommitSuccess(
          `Attendance Confirmed! ${participantName}${rollNum ? ` (${rollNum})` : ''} has been marked attended.`
        );
      }

      // Close preview modal
      setPreviewData(null);
      setScannerStatus('SUCCESS');

      // Notify parent to refresh attendance list / counts from live backend
      onAttendanceRecorded();

      // Reset success banner timer
      if (resetSuccessTimerRef.current) clearTimeout(resetSuccessTimerRef.current);
      resetSuccessTimerRef.current = setTimeout(() => {
        setScannerStatus('ACTIVE');
      }, 4000);

    } catch (err: any) {
      console.error('[AttendanceVerification] Commit attendance error:', err);
      setBusinessAlert({
        type: 'error',
        title: 'Attendance Check-in Failed',
        message: err?.message || 'Attendance check-in could not be recorded. Please try again.'
      });
    } finally {
      setIsCommitting(false);
      // Guarantee unlock so camera can immediately scan next student
      setTimeout(() => {
        isProcessingScanRef.current = false;
        lastScannedCodeRef.current = null;
        if (cameraActive) {
          setScannerStatus('ACTIVE');
        }
      }, 500);
    }
  };

  const handleDismissPreview = () => {
    setPreviewData(null);
    setBusinessAlert(null);
    // Unblock scanner for next QR
    isProcessingScanRef.current = false;
    lastScannedCodeRef.current = null;
    if (cameraActive) {
      setScannerStatus('ACTIVE');
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Title & Guidelines */}
      <div>
        <h3 className="text-base font-black uppercase tracking-tight text-gray-900">
          ATTENDANCE VERIFICATION
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Choose verification method to identify participant and preview details before confirming attendance.
        </p>
      </div>

      {/* Global Business Alert Banner */}
      {businessAlert && (
        <div 
          className={`p-4 rounded-2xl border flex items-start gap-3 shadow-2xs transition-all ${
            businessAlert.type === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {businessAlert.type === 'warning' ? (
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <span className={`text-[11px] font-black uppercase tracking-wider block ${
              businessAlert.type === 'warning' ? 'text-amber-800' : 'text-red-800'
            }`}>
              {businessAlert.title}
            </span>
            <p className={`text-xs sm:text-sm font-bold mt-0.5 break-words leading-relaxed ${
              businessAlert.type === 'warning' ? 'text-amber-950' : 'text-red-950'
            }`}>
              {businessAlert.message}
            </p>
          </div>
          <button 
            type="button"
            onClick={() => setBusinessAlert(null)} 
            className={`p-1 rounded-lg transition shrink-0 ${
              businessAlert.type === 'warning'
                ? 'text-amber-500 hover:text-amber-700 hover:bg-amber-100/50'
                : 'text-red-400 hover:text-red-600 hover:bg-red-100/50'
            }`}
            aria-label="Dismiss alert"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Global Success Banner */}
      {commitSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-medium text-emerald-800 flex items-start gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Attendance Recorded:</span>
            <span>{commitSuccess}</span>
          </div>
          <button onClick={() => setCommitSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          THREE VERTICAL OPERATIONS IN ONE COLUMN (Pure White Institutional Cards)
          ========================================================================= */}
      <div className="space-y-4">
        {/* OPERATION 1: SCAN QR CODE */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-red-50 text-kits-red rounded-xl border border-red-100 shrink-0">
              <Camera className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-black text-gray-900 uppercase tracking-tight">
                1. SCAN QR CODE
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Use your device camera to scan the student's digital or printed QR pass.
              </p>
            </div>
          </div>

          {!cameraActive ? (
            <div className="pl-0 sm:pl-14">
              <button
                type="button"
                onClick={startCamera}
                disabled={isVerifying}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold uppercase tracking-wider shadow-2xs hover:bg-red-700 active:scale-95 transition cursor-pointer"
              >
                <Camera className="h-4 w-4" />
                <span>Open Camera Scanner</span>
              </button>
            </div>
          ) : (
            <div className="pl-0 sm:pl-14 space-y-3 max-w-md">
              {/* Continuous Scanner Status Header */}
              <div className={`p-3 rounded-2xl border transition-all ${
                scannerStatus === 'SUCCESS' && lastConfirmedStudent
                  ? 'bg-emerald-950 text-white border-emerald-500 shadow-sm'
                  : 'bg-slate-900 text-white border-slate-800 shadow-sm'
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex h-3 w-3 shrink-0">
                      {scannerStatus === 'SUCCESS' ? (
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"></span>
                      ) : (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </>
                      )}
                    </span>
                    <div className="min-w-0">
                      <span className={`text-[11px] font-black uppercase tracking-wider block ${
                        scannerStatus === 'SUCCESS' ? 'text-emerald-300' : 'text-emerald-400'
                      }`}>
                        {scannerStatus === 'SUCCESS' ? '✓ ATTENDANCE CONFIRMED' : '● SCANNER ACTIVE'}
                      </span>
                      <p className="text-[11px] text-slate-300 font-medium truncate mt-0.5">
                        {isVerifying ? (
                          <span className="text-amber-300 flex items-center gap-1 font-bold">
                            <RefreshCw className="h-3 w-3 animate-spin" /> Resolving participant...
                          </span>
                        ) : scannerStatus === 'SUCCESS' && lastConfirmedStudent ? (
                          <span>
                            <strong>{lastConfirmedStudent.name}</strong> ({lastConfirmedStudent.rollNumber}) • Ready for next
                          </span>
                        ) : (
                          'Ready to scan next student'
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-red-600 hover:text-white text-slate-300 text-[11px] font-bold transition shrink-0 border border-slate-700 hover:border-red-600 cursor-pointer"
                    title="Stop camera scanner session"
                  >
                    <CameraOff className="h-3.5 w-3.5" />
                    <span>Close Camera</span>
                  </button>
                </div>
              </div>

              {/* Video Camera Viewport with Reticle */}
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-square border-2 border-kits-red shadow-md max-w-sm mx-auto sm:mx-0">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                />
                {/* Visual target reticle */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-44 h-44 border-2 border-white/90 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-kits-red -mt-0.5 -ml-0.5" />
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-kits-red -mt-0.5 -mr-0.5" />
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-kits-red -mb-0.5 -ml-0.5" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-kits-red -mb-0.5 -mr-0.5" />
                  </div>
                </div>

                {/* In-flight Verification Overlay */}
                {isVerifying && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center text-white space-y-2 p-4 text-center">
                    <RefreshCw className="h-8 w-8 animate-spin text-kits-red" />
                    <span className="text-xs font-black uppercase tracking-wider">
                      Verifying QR Pass...
                    </span>
                    <span className="text-[10px] text-gray-300">
                      Resolving participant identity & eligibility
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1">
                <span>Point student QR within the reticle frame</span>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="text-kits-red hover:underline font-bold cursor-pointer"
                >
                  Close Camera
                </button>
              </div>
            </div>
          )}

          {cameraError && (
            <div className="sm:ml-14 p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold block">Camera Error</span>
                <span>{cameraError}</span>
              </div>
            </div>
          )}
        </div>

        {/* OR DIVIDER */}
        <div className="flex items-center justify-center gap-3">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 bg-gray-50 px-3 py-1 rounded-full border border-gray-200">
            OR
          </span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        {/* OPERATION 2: UPLOAD QR CODE */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />

          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-50 text-kits-blue rounded-xl border border-blue-100 shrink-0">
              <Upload className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-black text-gray-900 uppercase tracking-tight">
                2. UPLOAD QR CODE
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload a photo or screenshot of the student's QR pass from this device storage.
              </p>
            </div>
          </div>

          <div className="pl-0 sm:pl-14">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isDecodingFile || isVerifying}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kits-blue text-white text-xs font-bold uppercase tracking-wider shadow-2xs hover:bg-blue-800 active:scale-95 transition disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              <span>{isDecodingFile ? 'Decoding QR Image...' : 'Choose QR Image'}</span>
            </button>
          </div>
        </div>

        {/* OR DIVIDER */}
        <div className="flex items-center justify-center gap-3">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 bg-gray-50 px-3 py-1 rounded-full border border-gray-200">
            OR
          </span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        {/* OPERATION 3: MANUAL VERIFICATION */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-gray-100 text-gray-800 rounded-xl border border-gray-200 shrink-0">
              <KeyRound className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm font-black text-gray-900 uppercase tracking-tight">
                3. MANUAL VERIFICATION TOKEN
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                The sub-event prefix is locked automatically. Enter the final 10 numeric digits from the student's pass.
              </p>
            </div>
          </div>

          <form onSubmit={handleManualSubmit} className="sm:pl-14 space-y-3 max-w-xl">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                Manual Token (10 Digits)
              </label>
              
              {/* Responsive Locked Prefix + 10-Digit Numeric Input Group */}
              <div className="flex flex-col sm:flex-row items-stretch rounded-xl border border-gray-300 bg-gray-50 focus-within:border-kits-blue focus-within:ring-1 focus-within:ring-kits-blue shadow-2xs overflow-hidden">
                {/* Visual Read-Only Prefix */}
                <div className="px-3.5 py-2.5 sm:py-3 bg-gray-100 border-b sm:border-b-0 sm:border-r border-gray-200 text-xs font-mono font-black text-gray-700 select-none flex items-center shrink-0 min-h-[44px]">
                  <span className="text-kits-red">{getCanonicalPrefix(subEventName)}</span>
                </div>

                {/* 10-Digit Numeric Input */}
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  maxLength={10}
                  required
                  value={manualTokenDigits}
                  onChange={handleDigitsChange}
                  placeholder="Enter 10 digits"
                  className="flex-1 bg-white sm:bg-transparent text-gray-900 text-sm font-mono font-bold px-4 py-2.5 sm:py-3 focus:outline-hidden min-h-[44px]"
                />
              </div>

              {/* Real-time Validation Feedback */}
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                {manualTokenDigits.length === 10 ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Valid 10-digit token ({getCanonicalPrefix(subEventName)}{manualTokenDigits})
                  </span>
                ) : manualTokenDigits.length > 0 ? (
                  <span className="text-amber-700 font-bold">
                    {10 - manualTokenDigits.length} digit{10 - manualTokenDigits.length > 1 ? 's' : ''} remaining (numeric only)
                  </span>
                ) : (
                  <span className="text-gray-400">
                    Format: {getCanonicalPrefix(subEventName)}XXXXXXXXXX
                  </span>
                )}
                <span className="font-mono text-gray-400 font-bold text-[10px]">
                  {manualTokenDigits.length}/10
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isVerifying || manualTokenDigits.length !== 10}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gray-900 text-white text-xs font-bold uppercase tracking-wider shadow-2xs hover:bg-kits-red active:scale-95 transition disabled:opacity-40 disabled:hover:bg-gray-900 min-h-[44px] cursor-pointer"
            >
              <KeyRound className="h-4 w-4" />
              <span>{isVerifying ? 'Verifying Token...' : 'Verify Token'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* =========================================================================
          VERIFICATION PREVIEW MODAL / PANEL (SCAN ≠ CHECK-IN)
          ========================================================================= */}
      {previewData && (() => {
        const isTeam = Boolean(
          previewData.team && (previewData.team.is_team || previewData.registration?.participation_type === 'TEAM')
        );
        const teamMembers: any[] = previewData.team?.members || [];
        const allTeamAttended = isTeam && teamMembers.length > 0 && teamMembers.every((m: any) => m.is_attended);

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 modal-overlay-animate">
            <div className="bg-white rounded-2xl sm:rounded-3xl max-w-xl w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl border border-gray-200 modal-dialog-animate max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
              
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-3 shrink-0">
                <div className="flex items-center gap-2">
                  {isTeam ? (
                    <Users className="h-5 w-5 text-kits-blue" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  )}
                  <h4 className="text-sm font-black uppercase text-gray-900 tracking-tight">
                    {isTeam ? 'Team Attendance Verification' : 'Participant Identity Verified'}
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={handleDismissPreview}
                  className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
                {isTeam ? (
                  /* =================================================================
                     TEAM ATTENDANCE VERIFICATION INTERFACE
                     ================================================================= */
                  <div className="space-y-4">
                    {/* Team Summary Card */}
                    <div className="p-3.5 sm:p-4 bg-blue-50/50 rounded-2xl border border-blue-100/80 space-y-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-kits-blue">
                            Team Registration
                          </div>
                          <h5 className="text-base font-black text-gray-900">
                            {previewData.team.team_name || 'Team'}
                          </h5>
                          <div className="text-xs text-gray-600 mt-0.5">
                            Sub-Event: <strong className="text-gray-800">{previewData.registration?.sub_event_name || subEventName || 'Event'}</strong>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-blue-100 text-blue-900 border border-blue-200">
                            <Users className="h-3 w-3 text-kits-blue" />
                            {teamMembers.length} Members
                          </span>
                          <div className="font-mono text-[10px] text-gray-400 mt-1">
                            Scanned Pass: {previewData.participant.name}
                          </div>
                        </div>
                      </div>

                      {allTeamAttended && (
                        <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-900 flex items-center gap-2 mt-1">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span>All members of this team have already been marked as attended.</span>
                        </div>
                      )}
                    </div>

                    {/* Member Selection Control Toolbar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-extrabold uppercase tracking-wider text-gray-900 flex items-center gap-1.5">
                          <UserCheck className="h-4 w-4 text-kits-blue" />
                          Registered Members:
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleSelectAllMembers}
                            disabled={allTeamAttended}
                            className="text-[11px] font-bold text-kits-blue hover:text-blue-800 disabled:opacity-40 transition cursor-pointer"
                          >
                            Select All
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            onClick={handleDeselectAllMembers}
                            disabled={selectedMemberIds.size === 0}
                            className="text-[11px] font-bold text-gray-500 hover:text-gray-700 disabled:opacity-40 transition cursor-pointer"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>

                      {/* Selection Counter Bar */}
                      <div className="px-3 py-2 bg-gray-100 rounded-xl border border-gray-200 flex items-center justify-between text-xs font-bold text-gray-800">
                        <span>
                          <strong className="text-kits-red text-sm font-black">{selectedMemberIds.size}</strong> of {teamMembers.length} members selected
                        </span>
                        <span className="text-[10px] text-gray-500 font-medium italic">
                          Individually check who actually attended
                        </span>
                      </div>

                      {/* Selectable Member Cards List */}
                      <div className="space-y-2 max-h-64 sm:max-h-72 overflow-y-auto pr-1">
                        {teamMembers.map((m: any) => {
                          const isAttended = Boolean(m.is_attended);
                          const isSelected = selectedMemberIds.has(m.id);

                          return (
                            <div
                              key={m.id}
                              onClick={() => {
                                if (!isAttended) {
                                  handleToggleMember(m.id);
                                }
                              }}
                              className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 select-none ${
                                isAttended
                                  ? 'bg-emerald-50/50 border-emerald-200/80 cursor-default'
                                  : isSelected
                                  ? 'bg-blue-50/60 border-kits-blue/80 shadow-2xs ring-1 ring-kits-blue/30 cursor-pointer'
                                  : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {/* Interactive Checkbox */}
                                <div className="shrink-0">
                                  {isAttended ? (
                                    <div className="h-5 w-5 rounded-md bg-emerald-600 text-white flex items-center justify-center">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    </div>
                                  ) : isSelected ? (
                                    <div className="h-5 w-5 rounded-md bg-kits-blue text-white flex items-center justify-center shadow-2xs">
                                      <CheckSquare className="h-4 w-4" />
                                    </div>
                                  ) : (
                                    <div className="h-5 w-5 rounded-md border-2 border-gray-300 bg-white flex items-center justify-center">
                                      <Square className="h-4 w-4 text-transparent" />
                                    </div>
                                  )}
                                </div>

                                {/* Member Information */}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-gray-900 text-xs sm:text-sm truncate">
                                      {m.snapshot_name}
                                    </span>
                                    {m.is_leader && (
                                      <span className="text-[8px] font-extrabold uppercase bg-blue-100 text-kits-blue px-1.5 py-0.5 rounded">
                                        Team Leader
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-mono text-[11px] font-bold text-gray-600 mt-0.5">
                                    Roll No: {m.snapshot_roll_number}
                                  </div>
                                  {(m.snapshot_department || m.snapshot_college) && (
                                    <div className="text-[10px] text-gray-500 truncate mt-0.5">
                                      {[m.snapshot_college, m.snapshot_department, m.snapshot_year ? `Year ${m.snapshot_year}` : null]
                                        .filter(Boolean)
                                        .join(' • ')}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Status Badge */}
                              <div className="text-right shrink-0">
                                {isAttended ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
                                    Attended
                                  </span>
                                ) : isSelected ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-blue-100 text-kits-blue border border-blue-300">
                                    Selected
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 border border-gray-200">
                                    Not Selected
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* =================================================================
                     SOLO PARTICIPANT VERIFICATION INTERFACE (100% UNCHANGED)
                     ================================================================= */
                  <div className="space-y-4">
                    {/* Primary Student Card */}
                    <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-black text-gray-900">{previewData.participant.name}</span>
                            {previewData.participant.is_leader && (
                              <span className="text-[9px] font-extrabold uppercase bg-blue-50 text-kits-blue px-2 py-0.5 rounded border border-blue-200">
                                Team Leader
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs font-bold text-gray-600 mt-0.5">
                            Roll No: {previewData.participant.roll_number}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {previewData.participant.college} • {previewData.participant.department} (Year {previewData.participant.year})
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                            previewData.attendance.is_attended
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-amber-100 text-amber-900 border border-amber-300'
                          }`}>
                            {previewData.attendance.is_attended ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                Already Attended
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 text-amber-600" />
                                Pending Check-in
                              </>
                            )}
                          </span>
                          {previewData.attendance.check_in_time && (
                            <p className="text-[9px] text-gray-400 font-mono mt-1">
                              Time: {new Date(previewData.attendance.check_in_time).toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-gray-200/80 text-[11px] font-mono flex items-center justify-between">
                        <span className="text-gray-500">Manual Token:</span>
                        <span className="font-bold text-kits-red">{previewData.participant.manual_token}</span>
                      </div>

                      {previewData.attendance.is_attended && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-900 flex items-center gap-2 mt-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                          <span>
                            <strong>{previewData.participant.name}</strong> is already marked as attended
                            {previewData.attendance.check_in_time ? ` (${new Date(previewData.attendance.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-3 border-t border-gray-100 shrink-0 w-full">
                <button
                  type="button"
                  onClick={handleDismissPreview}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer text-center"
                >
                  Cancel / Verify Next
                </button>

                {isTeam ? (
                  !allTeamAttended ? (
                    <button
                      type="button"
                      onClick={handleConfirmAttendance}
                      disabled={isCommitting || selectedMemberIds.size === 0}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-red-700 active:scale-95 transition disabled:opacity-50 cursor-pointer text-center"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        {isCommitting
                          ? 'Committing Attendance...'
                          : `Confirm Attendance (${selectedMemberIds.size} Selected)`}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl bg-gray-200 text-gray-500 text-xs font-bold uppercase tracking-wider border border-gray-300 cursor-not-allowed text-center"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>All Marked Attended</span>
                    </button>
                  )
                ) : !previewData.attendance.is_attended ? (
                  <button
                    type="button"
                    onClick={handleConfirmAttendance}
                    disabled={isCommitting}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl bg-kits-red text-white text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-red-700 active:scale-95 transition disabled:opacity-50 cursor-pointer text-center"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{isCommitting ? 'Committing...' : 'Confirm Attendance'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl bg-gray-200 text-gray-500 text-xs font-bold uppercase tracking-wider border border-gray-300 cursor-not-allowed text-center"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Already Marked</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
