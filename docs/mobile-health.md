# Mobile Health Integration

## Data Flow Sequence

```mermaid
sequenceDiagram
    participant App as Capacitor App
    participant HC as Android Health Connect
    participant Norm as Normalization Layer
    participant DB as Supabase DB

    App->>HC: Request Read/Write (Nutrition/Workout)
    HC-->>App: Raw Data / Record ID
    App->>Norm: Normalize Data for Backend
    Norm-->>App: Normalized Payload
    App->>DB: Sync Record with health_connect_record_id
    Note over App,Norm: Development Mode
    App->>Norm: Request Write (Web)
    Norm-->>App: Mock UUID
```

## Design Decisions

### Health Connect Plugin Choice
- Attempted to use multiple plugins. Both `@devmaxime/capacitor-health-connect` (read-only) and `@capgo/capacitor-health` (incomplete macro support) proved insufficient. 
- **Selected**: `@kiwi-health/capacitor-health-connect` strictly for its robust write mechanisms covering Protein, Carbohydrate, Fat, Fiber, and Exercise Sessions.

### Fallback Strategies
- Because Health Connect is strictly native Android, we maintain `src/services/health/index.ts` abstracting out Health Connect. If `Capacitor.isNativePlatform()` is false, mock services return mock UUIDs to ensure uninterrupted web-based development.

### Native Build Quirks
- The `android/app/src/main/AndroidManifest.xml` must explicitly include permission `<queries>` for `com.google.android.apps.healthdata` and alias activities specifically for `VIEW_PERMISSION_USAGE` in API >= 34.
- Dependency pinning is strictly enforced on `^7.0.0` for all Capacitor core/cli/android packages to maintain compatibility with the kiwi-health plugin.
