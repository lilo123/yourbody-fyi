import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { buildCspConnectSrcPolicy } from './src/build/cspPolicy.ts'
import { resolveCommitSha } from './src/build/versionResolver.ts'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { resolveSentryPluginConfig } from './src/build/sentryPluginConfig.ts'

function cspPinPlugin(rawUrl?: string): Plugin {
  let supabaseUrl = rawUrl;
  return {
    name: 'csp-pin-plugin',
    apply: 'build',
    configResolved(config) {
      if (!supabaseUrl) {
        const env = loadEnv(config.mode, config.root || process.cwd(), '');
        supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
      }
    },
    transformIndexHtml() {
      const policy = buildCspConnectSrcPolicy(supabaseUrl);
      if (!policy) {
        return;
      }
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: policy,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

function chunkReporterPlugin() {
  return {
    name: 'chunk-size-reporter',
    apply: 'build' as const,
    writeBundle(options: any, bundle: any) {
      const outDir = options.dir || 'dist';
      const rows: Array<{
        name: string;
        raw: number;
        gzip: number;
      }> = [];

      for (const [fileName, chunk] of Object.entries<any>(bundle)) {
        let buffer: Buffer;
        if (chunk.type === 'chunk') {
          buffer = Buffer.from(chunk.code, 'utf8');
        } else if (chunk.type === 'asset') {
          buffer = typeof chunk.source === 'string' ? Buffer.from(chunk.source, 'utf8') : Buffer.from(chunk.source);
        } else {
          continue;
        }

        const raw = buffer.length;
        const gzip = zlib.gzipSync(buffer).length;
        rows.push({ name: fileName, raw, gzip });
      }

      rows.sort((a, b) => b.raw - a.raw);

      console.log('\n=== BUILD CHUNK & ASSET SIZE REPORT ===');
      for (const r of rows) {
        console.log(
          `  ${r.name.padEnd(42)} | Raw: ${r.raw.toString().padStart(8)} B (${(r.raw / 1024).toFixed(2).padStart(7)} KB) | Gzip: ${r.gzip.toString().padStart(7)} B (${(r.gzip / 1024).toFixed(2).padStart(6)} KB)`
        );
      }
      console.log('========================================\n');

      try {
        const reportPath = path.resolve(outDir, 'bundle-size-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(rows, null, 2), 'utf8');
      } catch (err) {
        console.warn('Could not write bundle-size-report.json', err);
      }
    },
  };
}

function getPackageName(id: string): string | null {
  const normalized = id.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const lastIndex = normalized.lastIndexOf(marker);
  let pathAfter: string;
  if (lastIndex !== -1) {
    pathAfter = normalized.slice(lastIndex + marker.length);
  } else {
    const relMarker = 'node_modules/';
    const relIndex = normalized.lastIndexOf(relMarker);
    if (relIndex === -1) return null;
    pathAfter = normalized.slice(relIndex + relMarker.length);
  }
  if (pathAfter.startsWith('@')) {
    const segments = pathAfter.split('/');
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : null;
  }
  return pathAfter.split('/')[0] || null;
}

// Emits version.json with the commit being built so the deploy workflow can
// confirm which build is live. It is not part of the service worker precache.
function versionJsonPlugin(): Plugin {
  return {
    name: 'version-json-plugin',
    apply: 'build',
    generateBundle() {
      const sha = resolveCommitSha();
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ sha }),
      });
    },
  };
}

function cleanSourceMapsPlugin(): Plugin {
  let resolvedOutDir = 'dist';
  return {
    name: 'clean-sourcemaps-post-build',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      resolvedOutDir = config.build.outDir || 'dist';
    },
    closeBundle() {
      const deleteMaps = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            deleteMaps(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.map')) {
            try {
              fs.unlinkSync(fullPath);
            } catch (err) {
              console.warn('[cleanSourceMapsPlugin] Failed to delete map:', fullPath, err);
            }
          }
        }
      };
      deleteMaps(path.resolve(resolvedOutDir));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const mergedEnv = { ...process.env, ...env };
  const appCommit = resolveCommitSha(mergedEnv);
  const sentryConfig = resolveSentryPluginConfig(mergedEnv, appCommit);

  return {
    define: {
      __APP_COMMIT__: JSON.stringify(appCommit),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'generateSW',
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          name: 'Yourbody.fyi',
          short_name: 'Yourbody',
          description: 'Yourbody.fyi | Fitness & Nutrition',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
          globIgnores: ['**/Landing*'],
          navigateFallback: '/index.html',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: {
          enabled: false,
        },
      }),
      chunkReporterPlugin(),
      versionJsonPlugin(),
      cspPinPlugin(supabaseUrl),
      ...(sentryConfig.enabled && sentryConfig.options
        ? [
            sentryVitePlugin(sentryConfig.options),
            cleanSourceMapsPlugin(),
          ]
        : []),
    ],
    server: {
      watch: {
        // Vite's watcher covers the whole project root by default. The e2e gate
        // streams its Playwright reporter output into docs/evidence/ *while the
        // browser is driving the app*, and db-snapshot.js writes into scripts/.
        // Those writes trigger a full page reload mid-test, which resets React
        // state to the first page of results and surfaces as either a wrong count
        // or "Execution context was destroyed, most likely because of a
        // navigation". Verified directly: writing into docs/ every 200ms while
        // the suite runs makes even the login step time out.
        //
        // None of these paths are in the application's module graph, so ignoring
        // them does not affect HMR for real source edits.
        ignored: [
          '**/docs/**',
          '**/test-results/**',
          '**/playwright-report/**',
          '**/dist/**',
          '**/coverage/**',
          '**/supabase/**',
          '**/scripts/.db-snapshot-*.json',
          '**/*.tsbuildinfo',
        ],
      },
    },
    build: {
      ...(sentryConfig.sourcemap ? { sourcemap: sentryConfig.sourcemap } : {}),
      rollupOptions: {
        output: {
          manualChunks(id) {
            const pkg = getPackageName(id);
            if (!pkg) return;

            if (pkg.startsWith('@supabase/')) {
              return 'supabase';
            }
            if (pkg.startsWith('@tanstack/')) {
              return 'tanstack';
            }
            if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') {
              return 'react-vendor';
            }
            if (pkg === 'lucide-react') {
              return 'lucide-react';
            }
            if (pkg === 'react-hook-form') {
              return 'react-hook-form';
            }
            if (pkg === 'react-router' || pkg === 'react-router-dom') {
              return 'react-router-dom';
            }
            if (pkg === 'workbox-window' || pkg.startsWith('workbox-')) {
              return 'vendor';
            }
            if (pkg.startsWith('@sentry/')) {
              return 'sentry';
            }
            return 'vendor';
          },
        },
      },
    },
  };
})
