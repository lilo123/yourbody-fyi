import React, { useState, useContext, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ChevronDown, ChevronUp } from 'lucide-react';
import type { UserProfile } from '../../types/database';
import { CoachContext, type AthleteInfo } from '../../context/CoachContextTypes';
import { supabase } from '../../lib/supabase';
import {
  type ExportDomain,
  type ExportFormat,
  type DateRangePreset,
  type DataExportOptions,
  executeDataExport,
  downloadExportFiles,
} from '../../utils/dataExport';

export interface DataExportCardProps {
  profile: UserProfile | null;
  hasCoachCapability: boolean;
}

const DOMAIN_CONFIG: Array<{ id: ExportDomain; label: string }> = [
  { id: 'workouts', label: 'Workouts & Sets' },
  { id: 'nutrition_logs', label: 'Nutrition Logs' },
  { id: 'custom_dishes', label: 'Custom Dishes' },
  { id: 'routines', label: 'Routines' },
  { id: 'profile', label: 'Profile & Macros' },
];

export const DataExportCard: React.FC<DataExportCardProps> = ({
  profile,
  hasCoachCapability,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [targetAccount, setTargetAccount] = useState<string>('self');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [selectedDomains, setSelectedDomains] = useState<ExportDomain[]>([
    'workouts',
    'nutrition_logs',
  ]);
  const [preset, setPreset] = useState<DateRangePreset>('30d');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const targetSelectId = useId();
  const customStartId = useId();
  const customEndId = useId();

  // Safe CoachContext access: use useContext directly instead of useCoach()
  const coachCtx = useContext(CoachContext);
  const coachAthletes = coachCtx?.athletes;

  // Lazy query for active linked athletes if context is not mounted or has no athletes
  const { data: queriedAthletes } = useQuery({
    queryKey: ['coach_athlete_links_for_export', profile?.id],
    enabled:
      isExpanded &&
      hasCoachCapability &&
      (!coachAthletes || coachAthletes.length === 0) &&
      Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coach_athlete_links')
        .select('athlete_id, status, linked_at, athlete:users!athlete_id(id, username, email, role, created_at, timezone)')
        .eq('coach_id', profile!.id)
        .eq('status', 'active')
        .order('linked_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.athlete?.id || row.athlete_id,
        name: row.athlete?.username || 'Unknown Athlete',
        email: row.athlete?.email || '',
      }));
    },
  });

  const availableAthletes: AthleteInfo[] =
    coachAthletes && coachAthletes.length > 0 ? coachAthletes : queriedAthletes || [];

  const handleTargetChange = (val: string) => {
    setTargetAccount(val);
    if (val !== 'self') {
      // Auto-uncheck custom_dishes when selecting an athlete account
      setSelectedDomains((prev) => prev.filter((d) => d !== 'custom_dishes'));
    }
  };

  const handleToggleDomain = (domain: ExportDomain) => {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleSelectAll = () => {
    const allowedDomains: ExportDomain[] =
      targetAccount === 'self'
        ? ['workouts', 'nutrition_logs', 'custom_dishes', 'routines', 'profile']
        : ['workouts', 'nutrition_logs', 'routines', 'profile'];

    const allSelected = allowedDomains.every((d) => selectedDomains.includes(d));
    if (allSelected) {
      setSelectedDomains([]);
    } else {
      setSelectedDomains(allowedDomains);
    }
  };

  const handleDownload = async () => {
    if (selectedDomains.length === 0 || isExporting) return;

    setIsExporting(true);
    setStatusMessage('Preparing export...');

    try {
      const isSelfExport = targetAccount === 'self';
      const targetAthlete = !isSelfExport
        ? availableAthletes.find((a) => a.id === targetAccount)
        : null;
      const targetUserId = isSelfExport ? profile?.id : targetAccount;
      if (!targetUserId) {
        setStatusMessage('Export failed: user profile is not loaded');
        setIsExporting(false);
        return;
      }
      const targetUsername = isSelfExport
        ? profile?.username || 'user'
        : targetAthlete?.name || 'athlete';
      const targetEmail = isSelfExport
        ? profile?.email || null
        : targetAthlete?.email || null;
      const exportedByRole = hasCoachCapability ? 'coach' : 'athlete';

      const options: DataExportOptions = {
        targetUserId: targetUserId || '',
        targetUsername,
        targetEmail,
        exportedByRole,
        isSelfExport,
        format,
        domains: selectedDomains,
        preset,
        customStartDate: preset === 'custom' ? customStartDate : undefined,
        customEndDate: preset === 'custom' ? customEndDate : undefined,
      };

      const files = await executeDataExport(options, (progressMessage) => {
        setStatusMessage(progressMessage);
      });

      downloadExportFiles(files);
      setStatusMessage(`Export complete: downloaded ${files.length} file(s)`);
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Unknown export failure';
      setStatusMessage(`Export failed: ${errMessage}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Data Extract
            </h3>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Download your workouts, nutrition logs, routines, or full backup.
          </p>
        </div>

        <button
          type="button"
          data-testid="toggle-data-export-btn"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
          className="min-h-[44px] px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-950 text-xs font-bold text-zinc-300 hover:text-white hover:border-zinc-600 transition flex items-center gap-2 shrink-0 touch-manipulation"
        >
          <span>{isExpanded ? 'Hide Configuration' : 'Configure Export'}</span>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="pt-4 border-t border-zinc-800/80 space-y-4">
          {/* Target Account & Format Toggle Row */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            {hasCoachCapability && availableAthletes.length > 0 ? (
              <div className="flex-1 min-w-[200px]">
                <label
                  htmlFor={targetSelectId}
                  className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
                >
                  Target Account
                </label>
                <select
                  id={targetSelectId}
                  data-testid="export-target-select"
                  value={targetAccount}
                  onChange={(e) => handleTargetChange(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl p-2.5 text-base font-semibold focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
                >
                  <option value="self">My Personal Data</option>
                  {availableAthletes.map((a) => (
                    <option key={a.id} value={a.id}>
                      Athlete: {a.name}
                      {a.email ? ` (${a.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <span className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1">
                Format
              </span>
              <div className="flex items-center gap-1.5 bg-zinc-950 p-1 border border-zinc-800 rounded-xl">
                <button
                  type="button"
                  data-testid="export-format-json"
                  aria-pressed={format === 'json'}
                  onClick={() => setFormat('json')}
                  className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center ${
                    format === 'json'
                      ? 'bg-cyan-500 text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  JSON
                </button>
                <button
                  type="button"
                  data-testid="export-format-csv"
                  aria-pressed={format === 'csv'}
                  onClick={() => setFormat('csv')}
                  className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center ${
                    format === 'csv'
                      ? 'bg-cyan-500 text-black shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  CSV
                </button>
              </div>
            </div>
          </div>

          {/* Domain Checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Data Domains
              </span>
              <button
                type="button"
                data-testid="export-select-all-btn"
                onClick={handleSelectAll}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition min-h-[44px] px-2 flex items-center"
              >
                Select all
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {DOMAIN_CONFIG.map(({ id, label }) => {
                const isDishes = id === 'custom_dishes';
                const isDisabled = isDishes && targetAccount !== 'self';
                const isSelected = selectedDomains.includes(id);

                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`export-domain-${id}`}
                    aria-pressed={isSelected}
                    disabled={isDisabled}
                    onClick={() => handleToggleDomain(id)}
                    className={`min-h-[44px] p-2.5 rounded-xl border text-left flex items-center justify-between text-xs font-semibold transition ${
                      isDisabled
                        ? 'bg-zinc-950/40 border-zinc-900 text-zinc-600 cursor-not-allowed'
                        : isSelected
                        ? 'bg-cyan-500/10 border-cyan-500/60 text-cyan-300 shadow-sm'
                        : 'bg-zinc-950 border-zinc-800/80 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <span>{label}</span>
                    {isDisabled && (
                      <span className="text-xs font-bold text-amber-500/80 bg-amber-500/10 px-1.5 py-0.5 rounded uppercase">
                        Owner-only
                      </span>
                    )}
                    {!isDisabled && (
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                          isSelected
                            ? 'bg-cyan-500 border-cyan-500 text-black font-bold'
                            : 'border-zinc-700'
                        }`}
                      >
                        {isSelected ? '✓' : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range Presets */}
          <div>
            <span className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
              Date Range (Workouts & Nutrition)
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['7d', '30d', '90d', 'all', 'custom'] as const).map((p) => {
                const isSelected = preset === p;
                const label = p === 'all' ? 'All Time' : p === 'custom' ? 'Custom' : p;
                return (
                  <button
                    key={p}
                    type="button"
                    data-testid={`export-preset-${p}`}
                    aria-pressed={isSelected}
                    onClick={() => setPreset(p)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center ${
                      isSelected
                        ? 'bg-cyan-500/15 border border-cyan-500/60 text-cyan-300'
                        : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {preset === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-zinc-800/40">
                <div>
                  <label
                    htmlFor={customStartId}
                    className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
                  >
                    Start Date
                  </label>
                  <input
                    id={customStartId}
                    type="date"
                    data-testid="export-custom-start"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl p-2 text-base font-semibold focus:border-cyan-500 outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor={customEndId}
                    className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1"
                  >
                    End Date
                  </label>
                  <input
                    id={customEndId}
                    type="date"
                    data-testid="export-custom-end"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl p-2 text-base font-semibold focus:border-cyan-500 outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
            <output
              data-testid="export-status-text"
              aria-live="polite"
              className="text-xs text-zinc-400 min-h-[1.25rem] flex items-center"
            >
              {statusMessage}
            </output>

            <button
              type="button"
              data-testid="download-export-btn"
              disabled={selectedDomains.length === 0 || isExporting}
              onClick={handleDownload}
              className={`min-h-[44px] px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition ${
                selectedDomains.length === 0 || isExporting
                  ? 'bg-zinc-800 text-zinc-400 cursor-not-allowed opacity-50'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-neon-cyan active:scale-[0.98]'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>{isExporting ? 'Exporting...' : 'Download export'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
