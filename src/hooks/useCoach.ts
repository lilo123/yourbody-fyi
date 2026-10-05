import { useContext } from 'react';
import { CoachContext } from '../context/CoachContextTypes';

export const useCoach = () => {
  const context = useContext(CoachContext);
  if (!context) {
    throw new Error('useCoach must be used within a CoachProvider');
  }
  return context;
};
