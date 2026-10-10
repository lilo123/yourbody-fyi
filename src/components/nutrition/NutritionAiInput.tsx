import React, { memo, useMemo } from 'react';
import {
  Sparkles,
  ChevronUp,
  ChevronDown,
  X,
  Camera as CameraIcon,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Utensils,
  WifiOff,
} from 'lucide-react';
import { formatFileSize, type CompressedImage } from '../../utils/imageCompression';
import { CameraSource } from '@capacitor/camera';
import { StatusBanner } from '../common/StatusBanner';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { parseNutritionBlock } from '../../lib/nutrition/localParse';

export interface NutritionAiInputProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  nlInput: string;
  onNlInputChange: (text: string) => void;
  selectedPhoto: CompressedImage | null;
  onRemovePhoto: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPickPhoto: (source: CameraSource) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  showManualForm: boolean;
  onToggleManualForm: () => void;
  isRateLimited: boolean;
  onSwitchToManual: () => void;
  status: string;
  isError: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  hasCustomDishes: boolean;
  isOnline?: boolean;
}

export const NutritionAiInput: React.FC<NutritionAiInputProps> = memo(({
  textareaRef,
  headingRef,
  nlInput,
  onNlInputChange,
  selectedPhoto,
  onRemovePhoto,
  onFileChange,
  onPickPhoto,
  isAnalyzing,
  onAnalyze,
  showManualForm,
  onToggleManualForm,
  isRateLimited,
  onSwitchToManual,
  status,
  isError,
  fileInputRef,
  hasCustomDishes,
  isOnline: isOnlineProp,
}) => {
  const hookOnline = useOnlineStatus();
  const isOnline = isOnlineProp !== undefined ? isOnlineProp : hookOnline;

  const canParseLocally = useMemo(() => {
    if (!nlInput.trim() || selectedPhoto) return false;
    return parseNutritionBlock(nlInput.trim()).ok;
  }, [nlInput, selectedPhoto]);

  const isSubmitDisabled = isAnalyzing || (!isOnline ? !canParseLocally : (!nlInput.trim() && !selectedPhoto));
  return (
    <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-neon-cyan">
            <Sparkles className="w-4 h-4 text-zinc-950" />
          </div>
          <div>
            <h3 ref={headingRef} tabIndex={-1} className="text-xs font-bold text-white uppercase tracking-wider outline-none">
              Log Food
            </h3>
            <p className="text-xs text-zinc-400">
              Describe what you ate in natural language
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleManualForm}
          className="text-xs font-bold text-zinc-400 hover:text-white flex items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 px-3 py-2 min-h-[44px] min-w-[44px] rounded-xl transition border border-border-interactive touch-manipulation"
        >
          <span>{showManualForm ? 'Hide Manual' : 'Manual Entry'}</span>
          {showManualForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      <div className="bg-zinc-950 border border-border-interactive rounded-2xl p-3 focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-500/50 transition space-y-2.5">
        {selectedPhoto && (
          <div data-testid="photo-preview-container" className="relative flex items-center justify-between p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-cyan-500/40 shrink-0 bg-zinc-950 shadow-md">
                <img
                  src={selectedPhoto.dataUrl}
                  alt="Meal preview"
                  data-testid="photo-preview"
                  className="w-full h-full object-cover"
                />
                {!isAnalyzing && (
                  <button
                    type="button"
                    data-testid="remove-photo-button"
                    onClick={onRemovePhoto}
                    aria-label="Remove photo"
                    className="absolute top-0 right-0 min-w-[44px] min-h-[44px] p-2 rounded-full bg-zinc-950/80 hover:bg-rose-600 text-white flex items-center justify-center transition border border-border-interactive touch-manipulation"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {isAnalyzing && (
                  <div
                    data-testid="laser-scan-animation"
                    className="absolute inset-0 bg-cyan-500/25 pointer-events-none flex flex-col justify-around overflow-hidden"
                  >
                    <div className="w-full h-1 bg-cyan-300 shadow-[0_0_10px_#22d3ee] animate-pulse" />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span
                    data-testid="photo-size-badge"
                    className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-400 tabular-nums text-xs font-bold border border-cyan-500/30"
                  >
                    {formatFileSize(selectedPhoto.sizeBytes)}
                  </span>
                  <span className="text-xs text-zinc-400 tabular-nums">
                    {selectedPhoto.width}×{selectedPhoto.height}
                  </span>
                </div>
                <p className="text-xs font-bold text-zinc-300">Meal Photo Attached</p>
                <p className="text-xs text-zinc-400">Ready for multimodal analysis</p>
              </div>
            </div>

            {!isAnalyzing && (
              <button
                type="button"
                onClick={onRemovePhoto}
                className="text-xs text-zinc-400 hover:text-rose-400 font-bold px-2 py-1 min-h-[44px] min-w-[44px] flex items-center justify-center transition touch-manipulation"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={nlInput}
          onChange={(e) => onNlInputChange(e.target.value)}
          aria-describedby={!isOnline ? 'ai-offline-hint' : undefined}
          placeholder={
            selectedPhoto
              ? hasCustomDishes
                ? "Add notes or dish name to match custom dishes (e.g., 'Mom's Shake')..."
                : "Add notes or context (optional, e.g. 'dressing on the side', 'ate 2/3 of it')"
              : "Describe what you ate (e.g., 3 eggs, 2 slices sourdough, 1 tbsp butter)"
          }
          className="w-full bg-transparent text-white text-base placeholder:text-zinc-600 outline-none resize-none"
          rows={3}
        />

        {!isOnline && (
          <p
            id="ai-offline-hint"
            role="status"
            data-testid="ai-offline-hint"
            className="text-xs text-zinc-400 flex items-center gap-1.5"
          >
            <WifiOff className="w-3.5 h-3.5 text-zinc-400 shrink-0" aria-hidden="true" />
            <span>AI needs a connection: use quick log</span>
          </p>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-zinc-850">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="camera-trigger"
              onClick={() => onPickPhoto(CameraSource.Camera)}
              disabled={isAnalyzing || !isOnline}
              aria-describedby={!isOnline ? 'ai-offline-hint' : undefined}
              className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-cyan-400 border border-border-interactive transition flex items-center justify-center gap-1.5 text-xs font-bold disabled:opacity-50 touch-manipulation"
              title={!isOnline ? 'AI needs a connection: use quick log' : 'Take Photo'}
            >
              <CameraIcon className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Camera</span>
            </button>

            <button
              type="button"
              data-testid="gallery-trigger"
              onClick={() => onPickPhoto(CameraSource.Photos)}
              disabled={isAnalyzing || !isOnline}
              aria-describedby={!isOnline ? 'ai-offline-hint' : undefined}
              className="p-2.5 min-h-[44px] min-w-[44px] rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-cyan-400 border border-border-interactive transition flex items-center justify-center gap-1.5 text-xs font-bold disabled:opacity-50 touch-manipulation"
              title={!isOnline ? 'AI needs a connection: use quick log' : 'Photo Gallery'}
            >
              <ImageIcon className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Gallery</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="hidden-file-input"
              disabled={!isOnline}
              onChange={onFileChange}
            />
          </div>

          <button
            type="button"
            data-testid="analyze-meal-button"
            onClick={onAnalyze}
            disabled={isSubmitDisabled}
            aria-busy={isAnalyzing ? 'true' : undefined}
            aria-describedby={!isOnline ? 'ai-offline-hint' : undefined}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs px-4 py-2.5 min-h-[44px] min-w-[44px] rounded-xl shadow-neon-cyan active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-1.5 touch-manipulation"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAnalyzing ? 'Analyzing...' : 'Analyze Meal'}</span>
          </button>
        </div>
      </div>

      {/* Rate Limit 429 Cooldown Warning Banner */}
      <StatusBanner
        message={isRateLimited ? 'Rate Limit Exceeded (15 RPM)' : null}
        tone="error"
        testId="rate-limit-banner"
        className="space-y-3 shadow-lg flex-wrap sm:flex-nowrap"
        icon={<AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />}
        action={
          isRateLimited && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
              <p className="text-xs text-zinc-300 font-normal">
                Gemini rate limit exceeded (15 RPM). Please wait 15 seconds or switch to manual entry.
              </p>
              <div className="flex items-center justify-end gap-2 pt-1 border-t sm:border-t-0 border-amber-500/20">
                <button
                  type="button"
                  data-testid="switch-to-manual-btn"
                  onClick={onSwitchToManual}
                  className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs px-3.5 py-2.5 min-h-[44px] min-w-[44px] rounded-xl transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm touch-manipulation shrink-0"
                >
                  <Utensils className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Switch to Manual Entry</span>
                </button>
              </div>
            </div>
          )
        }
      />

      {/* Dynamic Status / Error Message */}
      <StatusBanner
        message={!isRateLimited && status ? status : null}
        tone={isError ? 'error' : 'info'}
        testId="status-message"
        className="shadow-lg"
        icon={
          isError ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />
          )
        }
        action={
          isError && onAnalyze ? (
            <button
              type="button"
              data-testid="retry-analysis-button"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 active:scale-95 rounded-lg transition-all min-h-[44px] min-w-[44px] touch-manipulation cursor-pointer shrink-0 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Retry Analysis</span>
            </button>
          ) : null
        }
      />
    </div>
  );
});

NutritionAiInput.displayName = 'NutritionAiInput';
