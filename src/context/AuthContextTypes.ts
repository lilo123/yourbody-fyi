import { createContext } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile, UserRole } from '../types/database';

export interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole;
  viewMode: UserRole;
  isCoachMode: boolean;
  loading: boolean;
  signIn: (email: string, password?: string) => Promise<{ success: boolean; error?: string; role?: UserRole }>;
  signUp: (email: string, password?: string, role?: UserRole, termsVersion?: string) => Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean; message?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  switchRole: (newRole: UserRole) => Promise<void>;
  refreshProfile: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
  changePassword?: (currentPassword: string, newPassword: string, nonce?: string) => Promise<{ success: boolean; error?: string; needsReauthentication?: boolean }>;
  reauthenticate?: () => Promise<{ success: boolean; error?: string }>;
  changeEmail?: (newEmail: string) => Promise<{ success: boolean; error?: string; user?: User }>;
  refreshSession?: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const USER_EDITABLE_PROFILE_KEYS = [
  'username',
  'target_calories',
  'target_protein',
  'target_carbs',
  'target_fat',
  'target_fiber',
  'auto_rest_timer',
  'rest_timer_seconds',
  'timezone',
  'weight_unit',
  'pr_mode',
  'is_coach_mode',
] as const;

export type EditableProfileKey = (typeof USER_EDITABLE_PROFILE_KEYS)[number];
