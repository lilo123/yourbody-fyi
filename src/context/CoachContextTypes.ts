import { createContext } from 'react';

export interface AthleteInfo {
  id: string;
  name: string;
  email: string;
  status?: string;
  last_active?: string;
  timezone?: string | null;
}

export interface CoachContextType {
  selectedAthleteId: string;
  selectedAthlete: AthleteInfo | null;
  athletes: AthleteInfo[];
  isCoach: boolean;
  switchAthlete: (athleteId: string) => void;
  refreshAthletes: () => Promise<void>;
}

export const CoachContext = createContext<CoachContextType | undefined>(undefined);
