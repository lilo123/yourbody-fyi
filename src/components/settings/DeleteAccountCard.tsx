import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { supabase } from '../../lib/supabase';
import {
  type DataExportOptions,
  executeDataExport,
  downloadExportFiles,
} from '../../utils/dataExport';
import { wipeUserData } from '../../utils/wipeUserData';

export const DeleteAccountCard: React.FC = () => {
  const isEnabled = useFeatureFlag('account_deletion_enabled');
  const isOnline = useOnlineStatus();
  const { user, profile, isCoachMode, signOut } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [confirmInput, setConfirmInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  if (!isEnabled) {
    return null;
  }

  const isConfirmed = confirmInput.trim() === 'DELETE';
  const canDelete = isConfirmed && isOnline && !isDeleting;

  const handleExportDataFirst = async () => {
    if (!profile?.id || isExporting) return;
    setIsExporting(true);
    setExportNotice(null);
    try {
      const options: DataExportOptions = {
        targetUserId: profile.id,
        targetUsername: profile.username || 'User',
        targetEmail: profile.email || null,
        exportedByRole: isCoachMode ? 'coach' : 'athlete',
        isSelfExport: true,
        format: 'json',
        domains: ['workouts', 'nutrition_logs', 'custom_dishes', 'routines', 'profile'],
        preset: 'all',
      };
      const files = await executeDataExport(options);
      downloadExportFiles(files);
      setExportNotice(`Export complete (${files.length} file${files.length === 1 ? '' : 's'}).`);
    } catch {
      setExportNotice('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!canDelete || !user?.id) return;

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { confirm: 'DELETE' },
      });

      if (error || !data?.deleted) {
        const errorText = error?.message || data?.error || 'Failed to delete account. Please try again.';
        setErrorMessage(errorText);
        setIsDeleting(false);
        return;
      }

      // Success sequence: wipe local data -> sign out -> navigate to /login
      await wipeUserData(user.id, { queryClient });
      await signOut();
      navigate('/login', {
        state: { message: 'Your account and data have been permanently deleted.' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(message);
      setIsDeleting(false);
    }
  };

  return (
    <div
      data-testid="delete-account-card"
      className="bg-zinc-900/90 border border-red-900/50 rounded-3xl p-5 shadow-2xl space-y-4"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
        <AlertTriangle className="w-5 h-5 text-red-500" aria-hidden="true" />
        <h3 className="text-base font-semibold text-zinc-100">Delete account</h3>
      </div>

      <p className="text-sm text-zinc-400">
        Permanently delete your account and all associated data including workouts, routine templates, custom exercises, and nutrition history. This action is irreversible.
      </p>

      {/* Export data button */}
      <div>
        <button
          type="button"
          onClick={handleExportDataFirst}
          disabled={isExporting || isDeleting}
          data-testid="delete-account-export-btn"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-200 transition-colors disabled:opacity-50"
        >
          <Download className="w-4 h-4 text-zinc-400" aria-hidden="true" />
          <span>{isExporting ? 'Exporting data...' : 'Export my data first'}</span>
        </button>
        {exportNotice && (
          <p className="text-xs text-zinc-400 mt-1">{exportNotice}</p>
        )}
      </div>

      {/* Confirmation text input */}
      <div className="space-y-1">
        <label
          htmlFor="delete-account-confirm-input"
          className="block text-sm text-zinc-300"
        >
          To confirm, type <span className="font-semibold text-red-400">DELETE</span> below:
        </label>
        <input
          id="delete-account-confirm-input"
          data-testid="delete-account-confirm-input"
          type="text"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          disabled={!isOnline || isDeleting}
          placeholder="DELETE"
          autoComplete="off"
          className="w-full px-3 py-2 rounded-xl bg-zinc-800/80 border border-zinc-700 text-zinc-100 placeholder-zinc-600 text-sm focus:outline-none focus:border-red-500 disabled:opacity-50"
        />
      </div>

      {/* Offline notice */}
      {!isOnline && (
        <p className="text-xs text-amber-400" data-testid="delete-account-offline-notice">
          Account deletion requires an active internet connection.
        </p>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="delete-account-error-alert"
          className="p-3 rounded-xl bg-red-950/40 border border-red-900/60 text-sm text-red-300"
        >
          {errorMessage}
        </div>
      )}

      {/* Action button */}
      <div>
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={!canDelete}
          data-testid="delete-account-submit-btn"
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          <span>{isDeleting ? 'Deleting account...' : 'Delete account'}</span>
        </button>
      </div>
    </div>
  );
};
