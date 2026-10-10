import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  Sparkles,
  X,
  Camera as CameraIcon,
  Image as ImageIcon,
  AlertCircle,
} from 'lucide-react';
import { CameraSource } from '@capacitor/camera';
import type { CustomDish } from '../../types/database';
import { formatFileSize } from '../../utils/imageCompression';
import { StatusBanner } from '../common/StatusBanner';
import { getScrollBehavior, type StagedItem } from './nutritionEngineHelpers';
import { parseNutrition, formatQuotaExceededMessage } from './parseNutrition';
import { useNutritionPhotoPicker } from './useNutritionPhotoPicker';

export interface AddItemsComposerProps {
  customDishes?: CustomDish[];
  scrollMarginBottom?: number;
  onParsed: (items: StagedItem[]) => void;
  onEnterManually: () => void;
  onCancel: () => void;
}

export const AddItemsComposer: React.FC<AddItemsComposerProps> = memo(({
  customDishes = [],
  scrollMarginBottom,
  onParsed,
  onEnterManually,
  onCancel,
}) => {
  const [text, setText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const isCancelledRef = useRef(false);
  const isAnalyzingRef = useRef(false);

  const {
    selectedPhoto,
    fileInputRef,
    handlePickPhoto,
    handleFileChange,
    handleRemovePhoto,
  } = useNutritionPhotoPicker({
    onError: (msg) => {
      setError(msg);
    },
    onClearError: () => {
      setError(null);
    },
  });

  useEffect(() => {
    const behavior = getScrollBehavior();
    const frameId = requestAnimationFrame(() => {
      if (typeof composerRef.current?.scrollIntoView === 'function') {
        composerRef.current.scrollIntoView({ block: 'nearest', behavior });
      }
    });
    textareaRef.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frameId);
  }, []);

  const handleCancel = useCallback(() => {
    isCancelledRef.current = true;
    onCancel();
  }, [onCancel]);

  const handleAnalyze = async () => {
    if (isAnalyzingRef.current || isAnalyzing || (!text.trim() && !selectedPhoto)) return;
    isAnalyzingRef.current = true;
    isCancelledRef.current = false;
    setIsAnalyzing(true);
    setError(null);

    try {
      const result = await parseNutrition({
        text,
        photo: selectedPhoto,
        customDishes,
      });

      if (isCancelledRef.current) return;
      onParsed(result.items);
    } catch (err: any) {
      if (isCancelledRef.current) return;
      if (err?.code === 'quota_exceeded') {
        const quotaMsg = err?.message || formatQuotaExceededMessage(err?.limit, err?.period);
        setError(quotaMsg);
      } else if (err?.is429 || err?.status === 429) {
        setError(
          err?.message ||
            'Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.'
        );
      } else {
        const errorMsg = err?.message || (typeof err === 'string' ? err : 'Unknown error');
        setError(
          err?.code === 'NON_FOOD_DETECTED' || err?.status === 422 || err?.context?.status === 422
            ? `Meal Analysis: ${errorMsg}`
            : `AI service unavailable: ${errorMsg}`
        );
      }
    } finally {
      isAnalyzingRef.current = false;
      if (!isCancelledRef.current) {
        setIsAnalyzing(false);
      }
    }
  };

  return (
    <div
      ref={composerRef}
      data-testid="add-items-composer"
      style={{ scrollMarginBottom: `${scrollMarginBottom ?? 64}px` }}
      className="bg-zinc-950 border border-border-interactive rounded-2xl p-3 focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/50 transition space-y-2.5 my-2"
    >
      {selectedPhoto && (
        <div
          data-testid="composer-photo-preview-container"
          className="relative flex items-center justify-between p-2 bg-zinc-900 border border-zinc-800 rounded-xl"
        >
          <div className="flex items-center gap-2.5">
            <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-cyan-500/40 shrink-0 bg-zinc-950 shadow-md">
              <img
                src={selectedPhoto.dataUrl}
                alt="Food item preview"
                data-testid="composer-photo-preview"
                className="w-full h-full object-cover"
              />
              {!isAnalyzing && (
                <button
                  type="button"
                  data-testid="composer-remove-photo"
                  onClick={handleRemovePhoto}
                  aria-label="Remove photo"
                  className="absolute top-0 right-0 min-w-[32px] min-h-[32px] p-1 rounded-full bg-zinc-950/80 hover:bg-rose-600 text-white flex items-center justify-center transition border border-border-interactive touch-manipulation"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 tabular-nums text-xs font-bold border border-cyan-500/30">
                {formatFileSize(selectedPhoto.sizeBytes)}
              </span>
              <p className="text-xs font-semibold text-zinc-300">Photo attached</p>
            </div>
          </div>
          {!isAnalyzing && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              className="text-xs text-zinc-400 hover:text-rose-400 font-bold px-2 py-1 min-h-[40px] flex items-center justify-center transition touch-manipulation"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        data-testid="composer-textarea"
        aria-label="Add items"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        placeholder="e.g. a banana and 200 ml oat milk"
        disabled={isAnalyzing}
        className="w-full bg-transparent text-white text-base placeholder:text-zinc-600 outline-none resize-none leading-relaxed"
        rows={2}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-850">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            data-testid="composer-camera-trigger"
            onClick={() => handlePickPhoto(CameraSource.Camera)}
            disabled={isAnalyzing}
            className="p-2 min-h-[40px] min-w-[40px] rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-cyan-400 border border-border-interactive transition flex items-center justify-center gap-1 text-xs font-bold disabled:opacity-50 touch-manipulation"
            title="Take Photo"
            aria-label="Take Photo"
          >
            <CameraIcon className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Camera</span>
          </button>

          <button
            type="button"
            data-testid="composer-gallery-trigger"
            onClick={() => handlePickPhoto(CameraSource.Photos)}
            disabled={isAnalyzing}
            className="p-2 min-h-[40px] min-w-[40px] rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-cyan-400 border border-border-interactive transition flex items-center justify-center gap-1 text-xs font-bold disabled:opacity-50 touch-manipulation"
            title="Photo Gallery"
            aria-label="Photo Gallery"
          >
            <ImageIcon className="w-4 h-4 text-cyan-400" />
            <span className="hidden sm:inline">Gallery</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="composer-hidden-file-input"
            onChange={handleFileChange}
          />

          <button
            type="button"
            data-testid="enter-manually-button"
            onClick={onEnterManually}
            disabled={isAnalyzing}
            className="text-xs text-zinc-400 hover:text-cyan-300 underline underline-offset-2 font-bold px-2 min-h-[40px] flex items-center justify-center transition touch-manipulation"
          >
            Enter manually
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            data-testid="cancel-composer-button"
            onClick={handleCancel}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold transition motion-reduce:transition-none border border-border-interactive flex items-center justify-center touch-manipulation"
          >
            Cancel
          </button>

          <button
            type="button"
            data-testid="analyze-items-button"
            onClick={handleAnalyze}
            disabled={isAnalyzing || (!text.trim() && !selectedPhoto)}
            aria-busy={isAnalyzing ? 'true' : undefined}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs px-3.5 py-2 min-h-[40px] rounded-xl shadow-neon-cyan active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-1.5 touch-manipulation"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAnalyzing ? 'Analyzing...' : 'Analyze'}</span>
          </button>
        </div>
      </div>

      {isAnalyzing && (
        <div
          data-testid="composer-loading"
          aria-live="polite"
          className="flex items-center gap-2 p-2 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-300"
        >
          <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <span>Analyzing items...</span>
        </div>
      )}

      <StatusBanner
        message={error}
        tone="error"
        testId="composer-error"
        className="text-xs"
        icon={<AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />}
      />
    </div>
  );
});

AddItemsComposer.displayName = 'AddItemsComposer';
