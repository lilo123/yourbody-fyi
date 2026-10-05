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
  signUp: (email: string, password?: string, role?: UserRole) => Promise<{ success: boolean; error?: string; needsEmailConfirmation?: boolean; message?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
  switchRole: (newRole: UserRole) => Promise<void>;
  refreshProfile: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<{ success: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
