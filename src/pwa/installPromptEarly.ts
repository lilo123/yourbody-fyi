export const FIRST_LOG_KEY = 'yourbody_install_prompt_first_log';
export const INSTALLED_KEY = 'yourbody_install_prompt_installed';

export interface BeforeInstallPromptChoice {
  outcome: 'accepted' | 'dismissed';
  platform: string;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<BeforeInstallPromptChoice>;
  prompt(): Promise<void>;
}

let prompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const logSubs = new Set<() => void>();
const pSubs = new Set<() => void>();

export const getStashedPrompt = () => prompt;
export const setStashedPrompt = (p: BeforeInstallPromptEvent | null) => {
  prompt = p;
  pSubs.forEach((f) => f());
};

export const isAppInstalledStashed = () => installed;
export const setAppInstalledStashed = (val: boolean) => {
  installed = val;
  if (val) {
    prompt = null;
    try {
      localStorage.setItem(INSTALLED_KEY, 'true');
    } catch {}
  }
  pSubs.forEach((f) => f());
};

export const hasLoggedFirstActivity = (): boolean => {
  try {
    return localStorage.getItem(FIRST_LOG_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markFirstLogCompleted = (): void => {
  try {
    localStorage.setItem(FIRST_LOG_KEY, 'true');
  } catch {}
  logSubs.forEach((f) => f());
};

export const onFirstLogRecorded = (f: () => void) => {
  logSubs.add(f);
  return () => {
    logSubs.delete(f);
  };
};

export const onPromptStashChanged = (f: () => void) => {
  pSubs.add(f);
  return () => {
    pSubs.delete(f);
  };
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setStashedPrompt(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => setAppInstalledStashed(true));
}
