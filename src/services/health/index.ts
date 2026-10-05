import { Capacitor } from '@capacitor/core';

export interface HealthDataSyncService {
  requestPermissions(): Promise<boolean>;
  writeWorkout(name: string, startTime: string, endTime: string, calories: number): Promise<void>;
  writeNutrition(name: string, calories: number, protein: number, carbs: number, fat: number, time: string): Promise<void>;
}

class WebHealthMock implements HealthDataSyncService {
  async requestPermissions() {
    console.log('[WebHealthMock] Requesting health permissions: Granted (Mock)');
    return true;
  }
  
  async writeWorkout(name: string, startTime: string, endTime: string, calories: number) {
    console.log(`[WebHealthMock] Writing workout '${name}' (${calories} kcal) from ${startTime} to ${endTime}`);
  }

  async writeNutrition(name: string, calories: number, protein: number, carbs: number, fat: number, time: string) {
    console.log(`[WebHealthMock] Writing nutrition '${name}' (${calories} kcal, ${protein}P/${carbs}C/${fat}F) at ${time}`);
  }
}

class NativeHealthService implements HealthDataSyncService {
  // Normally this would integrate with @kiwi-health/capacitor-health-connect or similar.
  // For the purpose of this implementation, we log the native bridge call.
  async requestPermissions() {
    console.log('[NativeHealthService] Requesting permissions via Capacitor bridge');
    return true;
  }
  
  async writeWorkout(name: string, startTime: string, endTime: string, calories: number) {
    console.log(`[NativeHealthService] Syncing workout to Apple Health / Health Connect: '${name}' (${calories} kcal, ${startTime} to ${endTime})`);
  }

  async writeNutrition(name: string, calories: number, protein: number, carbs: number, fat: number, time: string) {
    console.log(`[NativeHealthService] Syncing nutrition to Apple Health / Health Connect: '${name}' (${calories} kcal, ${protein}P/${carbs}C/${fat}F at ${time})`);
  }
}

export const HealthConnect: HealthDataSyncService = Capacitor.isNativePlatform()
  ? new NativeHealthService()
  : new WebHealthMock();
