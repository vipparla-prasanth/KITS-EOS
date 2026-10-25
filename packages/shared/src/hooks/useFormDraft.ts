import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  DraftType,
  FormDraft,
  DraftSaveResult,
  DraftSyncMessage,
} from '../utils/formDrafts';
import {
  saveUserDraft,
  getUserDrafts,
  deleteUserDraft,
  saveCoordinatorDraft,
  getCoordinatorDrafts,
  deleteCoordinatorDraft,
  getDraftSyncChannel,
} from '../utils/formDrafts';
import { getCookieConsent } from '../utils/cookieConsent';

export interface UseFormDraftOptions<T> {
  draftType: DraftType;
  entityId?: string | null;
  title?: string;
  coordinatorToken?: string | null;
  enabled?: boolean;
  debounceMs?: number;
  onDraftFound?: (draft: FormDraft<T>) => void;
}

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export function useFormDraft<T = any>({
  draftType,
  entityId = null,
  title,
  coordinatorToken = null,
  enabled = true,
  debounceMs = 1500,
  onDraftFound,
}: UseFormDraftOptions<T>) {
  const [draft, setDraft] = useState<FormDraft<T> | null>(null);
  const [hasExistingDraft, setHasExistingDraft] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);

  // Mutable refs to track current active version and pending debounced timer
  const currentDraftIdRef = useRef<string | null>(null);
  const currentVersionRef = useRef<number>(1);
  const debounceTimerRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);
  const latestPayloadRef = useRef<{ payload: T; step?: number } | null>(null);

  // Helpers for local storage persistence
  const getStorageKey = useCallback(() => {
    return `kits_eos_local_draft_${draftType}_${entityId || 'root'}`;
  }, [draftType, entityId]);

  const saveToLocal = useCallback((payload: T, step?: number) => {
    if (typeof window === 'undefined') return;
    try {
      // Respect user cookie preferences: do not store drafts in local storage if functional storage is disabled
      if (!getCookieConsent().preferences.functional) {
        return;
      }
      const dataToStore = {
        payload,
        step: step || 1,
        title: title || null,
        updated_at: new Date().toISOString(),
        draft_id: currentDraftIdRef.current,
        version: currentVersionRef.current,
      };
      localStorage.setItem(getStorageKey(), JSON.stringify(dataToStore));
    } catch {
      // non-fatal localStorage quota or disabled state
    }
  }, [getStorageKey, title]);

  const clearLocal = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(getStorageKey());
    } catch {
      // ignore
    }
  }, [getStorageKey]);

  // Check for existing draft on initial mount (comparing local vs remote)
  const checkForDraft = useCallback(async () => {
    if (!enabled) return;

    try {
      setIsInitialLoading(true);
      let drafts: FormDraft<T>[] = [];

      // 1. Check local storage first (only if user permitted functional preferences)
      let localDraftData: any = null;
      if (typeof window !== 'undefined' && getCookieConsent().preferences.functional) {
        try {
          const raw = localStorage.getItem(getStorageKey());
          if (raw) {
            localDraftData = JSON.parse(raw);
          }
        } catch {
          localDraftData = null;
        }
      }

      // 2. Check remote server drafts
      if (coordinatorToken) {
        drafts = await getCoordinatorDrafts(coordinatorToken, draftType, entityId);
      } else {
        drafts = await getUserDrafts(draftType, entityId);
      }

      if (!isMountedRef.current) return;

      const remoteFound = drafts.length > 0 ? drafts[0] : null;

      // Determine which draft is more recent or authoritative
      if (localDraftData && remoteFound) {
        const localTime = new Date(localDraftData.updated_at).getTime();
        const remoteTime = new Date(remoteFound.updated_at).getTime();

        if (localTime > remoteTime) {
          // Local changes are fresher than server snapshot
          const merged: FormDraft<T> = {
            ...remoteFound,
            payload: localDraftData.payload,
            current_step: localDraftData.step || remoteFound.current_step,
            updated_at: localDraftData.updated_at,
          };
          setDraft(merged);
          currentDraftIdRef.current = remoteFound.id;
          currentVersionRef.current = remoteFound.version;
          setLastSavedAt(new Date(localDraftData.updated_at));
          setHasExistingDraft(true);
          if (onDraftFound) onDraftFound(merged);
        } else {
          // Server snapshot is fresher or equal
          setDraft(remoteFound);
          currentDraftIdRef.current = remoteFound.id;
          currentVersionRef.current = remoteFound.version;
          setLastSavedAt(new Date(remoteFound.updated_at));
          setHasExistingDraft(true);
          if (onDraftFound) onDraftFound(remoteFound);
        }
      } else if (remoteFound) {
        setDraft(remoteFound);
        currentDraftIdRef.current = remoteFound.id;
        currentVersionRef.current = remoteFound.version;
        setLastSavedAt(new Date(remoteFound.updated_at));
        setHasExistingDraft(true);
        if (onDraftFound) onDraftFound(remoteFound);
      } else if (localDraftData) {
        const syntheticDraft: FormDraft<T> = {
          id: localDraftData.draft_id || 'local-draft',
          owner_type: coordinatorToken ? 'COORDINATOR' : 'STUDENT',
          draft_type: draftType,
          entity_id: entityId,
          title: localDraftData.title || title || 'Local Draft',
          payload: localDraftData.payload,
          current_step: localDraftData.step || 1,
          version: localDraftData.version || 1,
          created_at: localDraftData.updated_at,
          updated_at: localDraftData.updated_at,
        };
        setDraft(syntheticDraft);
        currentDraftIdRef.current = localDraftData.draft_id || null;
        currentVersionRef.current = localDraftData.version || 1;
        setLastSavedAt(new Date(localDraftData.updated_at));
        setHasExistingDraft(true);
        if (onDraftFound) onDraftFound(syntheticDraft);
      } else {
        setDraft(null);
        currentDraftIdRef.current = null;
        currentVersionRef.current = 1;
        setHasExistingDraft(false);
      }
    } catch (err) {
      console.warn('Draft lookup notice:', err);
    } finally {
      if (isMountedRef.current) {
        setIsInitialLoading(false);
      }
    }
  }, [enabled, coordinatorToken, draftType, entityId, onDraftFound, getStorageKey, title]);

  useEffect(() => {
    isMountedRef.current = true;
    checkForDraft();

    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [checkForDraft]);

  // Multi-tab BroadcastChannel listener
  useEffect(() => {
    const channel = getDraftSyncChannel();
    if (!channel) return;

    const handleMessage = (event: MessageEvent<DraftSyncMessage>) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      if (
        msg.draft_type === draftType &&
        (msg.entity_id || null) === (entityId || null)
      ) {
        if (msg.type === 'DRAFT_SAVED') {
          if (msg.version && msg.version > currentVersionRef.current) {
            currentVersionRef.current = msg.version;
            if (msg.updated_at) {
              setLastSavedAt(new Date(msg.updated_at));
            }
            if (msg.draft_id) {
              currentDraftIdRef.current = msg.draft_id;
            }
          }
        } else if (msg.type === 'DRAFT_DELETED') {
          clearLocal();
          if (currentDraftIdRef.current === msg.draft_id || !msg.draft_id) {
            setDraft(null);
            currentDraftIdRef.current = null;
            currentVersionRef.current = 1;
            setHasExistingDraft(false);
          }
        }
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
    };
  }, [draftType, entityId, clearLocal]);

  // Authoritative server save execution
  const executeSave = useCallback(
    async (payload: T, step?: number): Promise<DraftSaveResult> => {
      if (!enabled) {
        return { success: false, message: 'Draft saving not enabled' };
      }

      setSaveStatus('saving');
      setSaveErrorMessage(null);

      // Always update local storage first
      saveToLocal(payload, step);

      try {
        let result: DraftSaveResult;

        if (coordinatorToken) {
          result = await saveCoordinatorDraft({
            token: coordinatorToken,
            draftType,
            entityId,
            title: title || undefined,
            payload,
            currentStep: step,
            expectedVersion: currentVersionRef.current,
            draftId: currentDraftIdRef.current,
          });
        } else {
          result = await saveUserDraft({
            draftType,
            entityId,
            title: title || undefined,
            payload,
            currentStep: step,
            expectedVersion: currentVersionRef.current,
            draftId: currentDraftIdRef.current,
          });
        }

        if (!isMountedRef.current) return result;

        if (result.success) {
          if (result.draft_id) {
            currentDraftIdRef.current = result.draft_id;
          }
          if (typeof result.version === 'number') {
            currentVersionRef.current = result.version;
          }
          const savedDate = result.updated_at ? new Date(result.updated_at) : new Date();
          setLastSavedAt(savedDate);
          setSaveStatus('saved');
          // Re-update local storage with confirmed server draftId/version
          saveToLocal(payload, step);
          return result;
        } else if (result.conflict) {
          setSaveStatus('conflict');
          setSaveErrorMessage(
            result.message || 'Draft was updated in another window or tab.'
          );
          if (result.current_version) {
            currentVersionRef.current = result.current_version;
          }
          return result;
        } else {
          // If server returns error, local state is still preserved
          setSaveStatus('saved');
          return result;
        }
      } catch (err: any) {
        if (!isMountedRef.current) {
          return { success: false, message: err.message };
        }
        // Network error: draft is still safe locally in localStorage!
        setSaveStatus('saved');
        return { success: true, message: 'Saved locally' };
      }
    },
    [enabled, coordinatorToken, draftType, entityId, title, saveToLocal]
  );

  // Trigger autosave:
  // Continuous typing -> writes immediately to local storage, saves to server only at checkpoints or 30s idle
  const triggerAutosave = useCallback(
    (payload: T, step?: number, immediate: boolean = false) => {
      latestPayloadRef.current = { payload, step };

      // 1. Immediately persist to localStorage for continuous keystroke safety
      saveToLocal(payload, step);
      setLastSavedAt(new Date());
      setSaveStatus('saved');

      // 2. Clear any pending debounced server sync timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // 3. Immediate server checkpoint (e.g. step change, review screen, explicit save)
      if (immediate) {
        executeSave(payload, step);
      } else {
        // Non-immediate typing: sync to server at a relaxed idle checkpoint (default 30s)
        // instead of hammering the database every 1.5 seconds!
        const serverSyncDelay = Math.max(debounceMs, 30000);
        debounceTimerRef.current = setTimeout(() => {
          if (latestPayloadRef.current) {
            executeSave(
              latestPayloadRef.current.payload,
              latestPayloadRef.current.step
            );
          }
        }, serverSyncDelay);
      }
    },
    [executeSave, saveToLocal, debounceMs]
  );

  // Immediate explicit save
  const saveNow = useCallback(
    async (payload: T, step?: number) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return executeSave(payload, step);
    },
    [executeSave]
  );

  // User chooses to resume draft
  const resumeDraft = useCallback((): FormDraft<T> | null => {
    setHasExistingDraft(false);
    return draft;
  }, [draft]);

  // User chooses to start new
  const startNew = useCallback(() => {
    clearLocal();
    setHasExistingDraft(false);
  }, [clearLocal]);

  // User explicitly deletes draft (clears both server and local)
  const discardDraft = useCallback(async (): Promise<boolean> => {
    clearLocal();
    const draftIdToDelete = currentDraftIdRef.current || draft?.id;
    if (!draftIdToDelete || draftIdToDelete === 'local-draft') {
      setDraft(null);
      setHasExistingDraft(false);
      return true;
    }

    try {
      let deleted = false;
      if (coordinatorToken) {
        deleted = await deleteCoordinatorDraft(coordinatorToken, draftIdToDelete);
      } else {
        deleted = await deleteUserDraft(draftIdToDelete);
      }

      if (isMountedRef.current) {
        setDraft(null);
        currentDraftIdRef.current = null;
        currentVersionRef.current = 1;
        setHasExistingDraft(false);
        setSaveStatus('idle');
      }
      return deleted;
    } catch (err) {
      console.error('Failed to delete draft:', err);
      return false;
    }
  }, [coordinatorToken, draft?.id, clearLocal]);

  const clearLocalDraftState = useCallback(() => {
    clearLocal();
    setDraft(null);
    currentDraftIdRef.current = null;
    currentVersionRef.current = 1;
    setHasExistingDraft(false);
    setSaveStatus('idle');
  }, [clearLocal]);

  return {
    draft,
    hasExistingDraft,
    saveStatus,
    saveErrorMessage,
    lastSavedAt,
    version: currentVersionRef.current,
    isInitialLoading,
    triggerAutosave,
    saveNow,
    resumeDraft,
    startNew,
    discardDraft,
    clearLocalDraftState,
  };
}
