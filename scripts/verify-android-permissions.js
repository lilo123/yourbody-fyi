import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, '../android/app/src/main/AndroidManifest.xml');

try {
  const content = fs.readFileSync(manifestPath, 'utf8');

  // Verify the required Health Connect strings are present
  const hasRead = content.includes('<uses-permission android:name="android.permission.health.READ_NUTRITION"/>');
  const hasWrite = content.includes('<uses-permission android:name="android.permission.health.WRITE_NUTRITION"/>');

  if (hasRead && hasWrite) {
    console.log('[SUCCESS] AndroidManifest.xml contains the required Health Connect strings.');
    process.exit(0);
  } else {
    console.error('[ERROR] AndroidManifest.xml is missing out on the exact Health Connect strings.');
    if (!hasRead) console.error('  - Missing: android.permission.health.READ_NUTRITION');
    if (!hasWrite) console.error('  - Missing: android.permission.health.WRITE_NUTRITION');
    process.exit(1);
  }
} catch (error) {
  console.error('[ERROR] Could not read AndroidManifest.xml', error);
  process.exit(1);
}
