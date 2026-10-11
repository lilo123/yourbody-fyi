export interface SentryPluginConfigResult {
  enabled: boolean;
  sourcemap?: 'hidden';
  options: {
    authToken?: string;
    org?: string;
    project?: string;
    telemetry: boolean;
    release: {
      name: string;
      inject?: boolean;
      create?: boolean;
      finalize?: boolean;
    };
    sourcemaps: {
      assets?: string[];
      filesToDeleteAfterUpload?: string[];
    };
    errorHandler: (err: Error) => void;
  } | null;
}

export function resolveSentryPluginConfig(
  env: Record<string, string | undefined> = process.env,
  commitSha = 'dev'
): SentryPluginConfigResult {
  const isMeasure = env.SENTRY_PLUGIN_MEASURE === 'true' || env.SENTRY_MEASURE === 'true';

  if (isMeasure) {
    return {
      enabled: true,
      sourcemap: 'hidden',
      options: {
        telemetry: false,
        release: {
          name: commitSha,
          inject: false,
          create: false,
          finalize: false,
        },
        sourcemaps: {
          assets: [],
          filesToDeleteAfterUpload: ['dist/**/*.map', 'dist/*.map'],
        },
        errorHandler: (err: Error) => {
          console.warn('[sentry/vite-plugin] Source map upload error ignored:', err?.message || err);
        },
      },
    };
  }

  const authToken = env.SENTRY_AUTH_TOKEN?.trim();
  const org = env.SENTRY_ORG?.trim();
  const project = env.SENTRY_PROJECT?.trim();

  if (!authToken || !org || !project) {
    return {
      enabled: false,
      sourcemap: undefined,
      options: null,
    };
  }

  return {
    enabled: true,
    sourcemap: 'hidden',
    options: {
      authToken,
      org,
      project,
      telemetry: false,
      release: {
        name: commitSha,
        inject: false,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.map', 'dist/*.map'],
      },
      errorHandler: (err: Error) => {
        console.warn('[sentry/vite-plugin] Source map upload error ignored:', err?.message || err);
      },
    },
  };
}

