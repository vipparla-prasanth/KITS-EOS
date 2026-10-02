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

  // Check for existing draft on initial mount
  const checkForDraft = useCallback(async () => {
    if (!enabled) return;

    try {
      setIsInitialLoading(true);
      let drafts: FormDraft<T>[] = [];

      if (coordinatorToken) {
        drafts = await getCoordinatorDrafts(coordinatorToken, draftType, entityId);
      } else {
        drafts = await getUserDrafts(draftType, entityId);
      }

      if (!isMountedRef.current) return;

      if (drafts.length > 0) {
        const found = drafts[0];
        setDraft(found);
        currentDraftIdRef.current = found.id;
        currentVersionRef.current = found.version;
        setLastSavedAt(new Date(found.updated_at));
        setHasExistingDraft(true);
        if (onDraftFound) {
          onDraftFound(found);
        }
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
  }, [enabled, coordinatorToken, draftType, entityId, onDraftFound]);

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
          if (currentDraftIdRef.current === msg.draft_id) {
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
  }, [draftType, entityId]);

  // Authoritative save execution
  const executeSave = useCallback(
    async (payload: T, step?: number): Promise<DraftSaveResult> => {
      if (!enabled) {
        return { success: false, message: 'Draft saving not enabled' };
      }

      setSaveStatus('saving');
      setSaveErrorMessage(null);

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
          if (result.updated_at) {
            setLastSavedAt(new Date(result.updated_at));
          } else {
            setLastSavedAt(new Date());
          }
          setSaveStatus('saved');
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
          setSaveStatus('error');
          setSaveErrorMessage(result.message || 'Unable to save draft.');
          return result;
        }
      } catch (err: any) {
        if (!isMountedRef.current) {
          return { success: false, message: err.message };
        }
        setSaveStatus('error');
        setSaveErrorMessage(err.message || 'Network error while saving draft.');
        return { success: false, message: err.message };
      }
    },
    [enabled, coordinatorToken, draftType, entityId, title]
  );

  // Trigger autosave with debounce
  const triggerAutosave = useCallback(
    (payload: T, step?: number, immediate: boolean = false) => {
      latestPayloadRef.current = { payload, step };

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (immediate) {
        executeSave(payload, step);
      } else {
        debounceTimerRef.current = setTimeout(() => {
          if (latestPayloadRef.current) {
            executeSave(
              latestPayloadRef.current.payload,
              latestPayloadRef.current.step
            );
          }
        }, debounceMs);
      }
    },
    [executeSave, debounceMs]
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
    setHasExistingDraft(false);
  }, []);

  // User explicitly deletes draft
  const discardDraft = useCallback(async (): Promise<boolean> => {
    const draftIdToDelete = currentDraftIdRef.current || draft?.id;
    if (!draftIdToDelete) {
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
  }, [coordinatorToken, draft?.id]);

  const clearLocalDraftState = useCallback(() => {
    setDraft(null);
    currentDraftIdRef.current = null;
    currentVersionRef.current = 1;
    setHasExistingDraft(false);
    setSaveStatus('idle');
  }, []);

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
