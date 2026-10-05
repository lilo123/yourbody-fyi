import { useState, useEffect, useId, useRef, useCallback } from "react";
import type { Exercise, RoutineTemplate } from "../../types/database";
import { resolveExerciseLabel } from "../../utils/exerciseLabel";
import { supabase } from "../../lib/supabase";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import type { CatalogExercise } from "../../lib/exercises";

export interface EditableTemplateExercise {
  id?: string;
  exercise_id: string;
  exercise_name: string;
  body_parts?: string[] | null;
  target_sets: number;
  target_reps: number;
}

export function mapTemplateExercises(items: any[], exerciseList: Exercise[] = []): EditableTemplateExercise[] {
  return [...items]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map((item) => {
      const matched = exerciseList.find(
        (e) => e.id === item.exercise_id || e.name.toLowerCase() === item.exercise_id?.toLowerCase()
      );
      return {
        id: item.id,
        exercise_id: matched ? matched.id : item.exercise_id,
        exercise_name: resolveExerciseLabel(item.exercise?.name || item.exercise_name || matched?.name || item.exercise_id),
        body_parts: item.exercise?.body_parts || (matched as any)?.body_parts || item.body_parts || null,
        target_sets: item.target_sets || 3,
        target_reps: item.target_reps || 10,
      };
    });
}

export interface UseTemplateEditorOptions {
  isOpen: boolean;
  template: RoutineTemplate | null;
  onClose: () => void;
  onSaved?: () => void;
  onSuccess?: () => void;
  assignToAthleteId?: string | null;
  allowMaster?: boolean;
  exercises?: Exercise[];
  targetUserId?: string;
  isFork?: boolean;
}

export function useTemplateEditor({
  isOpen,
  template,
  onClose,
  onSaved,
  onSuccess,
  assignToAthleteId,
  allowMaster = false,
  exercises = [],
  targetUserId = "",
  isFork = false,
}: UseTemplateEditorOptions) {
  const templateNameId = useId();
  const addExerciseBtnRef = useRef<HTMLButtonElement>(null);
  const isOnline = useOnlineStatus();

  const [name, setName] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [templateExercises, setTemplateExercises] = useState<EditableTemplateExercise[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleError, setStaleError] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [latestUpdatedAt, setLatestUpdatedAt] = useState<string | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const exercisesRef = useRef(exercises);
  useEffect(() => {
    exercisesRef.current = exercises;
  }, [exercises]);

  const fetchFreshTemplate = useCallback(async (templateId: string) => {
    setIsLoadingTemplate(true);
    setFetchError(null);
    try {
      // payload-gate: detail-fetch — single template loaded on demand when user opens EditTemplateSheet
      const { data, error: fetchErr } = await supabase
        .from("routine_templates")
        .select("*, exercises:template_exercises(*, exercise:exercises(*))")
        .eq("id", templateId)
        .single();
      if (fetchErr) throw fetchErr;
      if (data) {
        setName(data.name || "");
        setDays(data.days_of_week ? [...data.days_of_week] : []);
        setLatestUpdatedAt((data as any).updated_at ?? null);
        setTemplateExercises(data.exercises?.length ? mapTemplateExercises(data.exercises, exercisesRef.current) : []);
        setStaleError(false);
        setError(null);
      }
    } catch (err: any) {
      setFetchError(err?.message || "Failed to load template.");
    } finally {
      setIsLoadingTemplate(false);
    }
  }, []);

  const [prevSyncKey, setPrevSyncKey] = useState<string>("");
  const syncKey = `${isOpen ? "1" : "0"}-${template?.id || "new"}-${isFork ? "1" : "0"}`;

  if (prevSyncKey !== syncKey) {
    setPrevSyncKey(syncKey);
    if (isOpen) {
      if (template?.id && !isFork) {
        setIsLoadingTemplate(true);
        setFetchError(null);
      } else if (template && isFork) {
        const cleanName = template.name.replace(/\s*\(Copy\)\s*$/i, "");
        setName(cleanName);
        setDays(template.days_of_week ? [...template.days_of_week] : []);
        setTemplateExercises(template.exercises?.length ? mapTemplateExercises(template.exercises, exercises) : []);
        setError(null);
        setStaleError(false);
        setIsPickerOpen(false);
        setReorderAnnouncement("");
        setLatestUpdatedAt(null);
        setIsLoadingTemplate(false);
        setFetchError(null);
      } else {
        setName("");
        setDays([]);
        setTemplateExercises([]);
        setError(null);
        setStaleError(false);
        setIsPickerOpen(false);
        setReorderAnnouncement("");
        setLatestUpdatedAt(null);
        setIsLoadingTemplate(false);
        setFetchError(null);
      }
    } else {
      setIsLoadingTemplate(false);
      setFetchError(null);
    }
  }

  useEffect(() => {
    if (isOpen && template?.id && !isFork) {
      queueMicrotask(() => { void fetchFreshTemplate(template.id); });
    }
  }, [isOpen, template?.id, isFork, fetchFreshTemplate]);

  const toggleDay = (d: string) => {
    if (saving) return;
    setDays((prev) =>
      prev.includes(d) ? prev.filter((item) => item !== d) : [...prev, d]
    );
  };

  const moveExercise = (index: number, delta: number) => {
    if (saving) return;
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= templateExercises.length) return;
    const copy = [...templateExercises];
    const item = copy[index];
    copy[index] = copy[newIdx];
    copy[newIdx] = item;
    setTemplateExercises(copy);
    setReorderAnnouncement(
      `Moved ${item.exercise_name} to position ${newIdx + 1} of ${copy.length}`
    );
  };

  const removeExercise = (index: number) => {
    if (saving || isSavingRef.current) return;
    const item = templateExercises[index];
    setTemplateExercises((prev) => prev.filter((_, i) => i !== index));
    if (item) setReorderAnnouncement(`Removed ${item.exercise_name} from routine`);
  };

  const updateSets = (index: number, val: number) => {
    if (saving || isSavingRef.current) return;
    const clamped = Math.max(1, Math.min(20, isNaN(val) || !val ? 1 : val));
    setTemplateExercises((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, target_sets: clamped } : item
      )
    );
  };

  const updateReps = (index: number, val: number) => {
    if (saving || isSavingRef.current) return;
    const clamped = Math.max(1, Math.min(100, isNaN(val) || !val ? 1 : val));
    setTemplateExercises((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, target_reps: clamped } : item
      )
    );
  };

  const handleOpenPicker = () => {
    if (saving) return;
    setIsPickerOpen(true);
  };

  const handleClosePicker = () => {
    setIsPickerOpen(false);
    setTimeout(() => {
      addExerciseBtnRef.current?.focus();
    }, 0);
  };

  const handleAddFromPicker = (selected: CatalogExercise[]) => {
    setTemplateExercises((prev) => {
      const copy = [...prev];
      const newlyAdded: string[] = [];
      for (const ex of selected) {
        if (!copy.some((te) => te.exercise_id === ex.id || te.exercise_name.toLowerCase() === ex.name.toLowerCase())) {
          copy.push({ exercise_id: ex.id, exercise_name: ex.name, body_parts: ex.body_parts, target_sets: 3, target_reps: 10 });
          newlyAdded.push(ex.name);
        }
      }
      if (newlyAdded.length === 1) setReorderAnnouncement(`Added ${newlyAdded[0]} to routine`);
      else if (newlyAdded.length > 1) setReorderAnnouncement(`Added ${newlyAdded.length} exercises to routine`);
      return copy;
    });
    handleClosePicker();
  };

  const handleReload = async () => {
    if (!template?.id) return;
    setIsReloading(true);
    try {
      await fetchFreshTemplate(template.id);
      setStaleError(false);
    } finally {
      setIsReloading(false);
    }
  };

  const handleSave = async () => {
    if (saving || isSavingRef.current) return;
    if (!isOnline) {
      setError("Available when online");
      return;
    }
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }
    if (templateExercises.length === 0) {
      setError("Please add at least one exercise to the template.");
      return;
    }

    isSavingRef.current = true;
    setSaving(true);
    setError(null);
    setStaleError(false);

    const rpcId = isFork ? null : template?.id || null;
    const isMaster = Boolean(template?.is_master || allowMaster) && !isFork;
    const effectiveUserId = assignToAthleteId || targetUserId;

    const exercisePayload = templateExercises.map((e, idx) => ({
      exercise_id: e.exercise_id,
      target_sets: Math.max(1, Math.min(20, isNaN(Number(e.target_sets)) || !e.target_sets ? 1 : Number(e.target_sets))),
      target_reps: Math.max(1, Math.min(100, isNaN(Number(e.target_reps)) || !e.target_reps ? 1 : Number(e.target_reps))),
      order_index: idx,
    }));

    const rpcPayload: Record<string, any> = {
      p_template_id: rpcId as unknown as string,
      p_name: name.trim(),
      p_days_of_week: days,
      p_exercises: exercisePayload,
      p_user_id: effectiveUserId,
      p_is_master: isMaster,
    };

    if (assignToAthleteId) {
      rpcPayload.p_assigned_to = assignToAthleteId;
    }

    if (template?.id && !isFork) {
      rpcPayload.p_expected_updated_at = latestUpdatedAt ?? null;
    }

    try {
      const { error: rpcErr } = await supabase.rpc(
        "save_routine_template",
        rpcPayload
      );

      if (rpcErr) {
        throw rpcErr;
      }

      onSaved?.();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      const isStale =
        err?.code === "PT409" ||
        err?.message === "stale_template" ||
        err?.message?.includes?.("stale_template");
      if (isStale) {
        setStaleError(true);
      } else {
        setError(err?.message || "Failed to save template. Please try again.");
      }
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const titleText = isFork
    ? "Customize Routine"
    : template
    ? "Edit Routine Template"
    : "Create Routine Template";

  return {
    templateNameId,
    addExerciseBtnRef,
    name,
    setName,
    days,
    setDays,
    toggleDay,
    templateExercises,
    setTemplateExercises,
    isPickerOpen,
    setIsPickerOpen,
    handleOpenPicker,
    handleClosePicker,
    handleAddFromPicker,
    error,
    setError,
    staleError,
    setStaleError,
    isReloading,
    saving,
    reorderAnnouncement,
    setReorderAnnouncement,
    latestUpdatedAt,
    isLoadingTemplate,
    fetchError,
    fetchFreshTemplate,
    moveExercise,
    removeExercise,
    updateSets,
    updateReps,
    handleReload,
    handleSave,
    titleText,
  };
}
