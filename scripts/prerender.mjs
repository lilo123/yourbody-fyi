#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Polyfill/stub browser globals in Node SSR:
// 1. WebSocket dummy class for Supabase realtime client initialization
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {};
}

// 2. BroadcastChannel stub: Node.js native BroadcastChannel creates an active
// MessagePort handle that keeps Node's event loop open indefinitely.
// Replace with a no-op stub for the static rendering pass.
globalThis.BroadcastChannel = class StubBroadcastChannel {
  name;
  onmessage = null;
  onmessageerror = null;
  constructor(name) {
    this.name = name;
  }
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const ssrDir = path.resolve(rootDir, 'dist-ssr');
const indexHtmlPath = path.resolve(distDir, 'index.html');

if (!fs.existsSync(indexHtmlPath)) {
  console.error(`[prerender] dist/index.html not found at ${indexHtmlPath}`);
  process.exit(1);
}

const template = fs.readFileSync(indexHtmlPath, 'utf8');

const ssrEntryPath = path.resolve(ssrDir, 'entry-server.js');
if (!fs.existsSync(ssrEntryPath)) {
  console.error(`[prerender] SSR entry not found at ${ssrEntryPath}`);
  process.exit(1);
}

const { renderRoute, PRERENDER_ROUTES } = await import(pathToFileURL(ssrEntryPath).href);

console.log('[prerender] Pre-rendering public pages...');

try {
  for (const route of PRERENDER_ROUTES) {
    const renderedMarkup = renderRoute(route.path);

    let html = template;
    if (html.includes('<div id="prerender">')) {
      html = html.replace(
        /<div id="prerender">[\s\S]*?<\/div>/,
        `<div id="prerender">${renderedMarkup}</div>`
      );
    } else {
      html = html.replace(
        '<div id="root"></div>',
        `<div id="prerender">${renderedMarkup}</div><div id="root"></div>`
      );
    }

    if (route.path !== '/') {
      html = html.replace(
        /<title>.*?<\/title>/,
        `<title>${route.title}</title>`
      );
      html = html.replace(
        /<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i,
        `<meta name="description" content="${route.description}" />`
      );
      html = html.replace(
        /<meta\s+property=["']og:title["']\s+content=["'][^"']*["']\s*\/?>/i,
        `<meta property="og:title" content="${route.title}" />`
      );
      html = html.replace(
        /<meta\s+property=["']og:description["']\s+content=["'][^"']*["']\s*\/?>/i,
        `<meta property="og:description" content="${route.description}" />`
      );
      html = html.replace(
        /<meta\s+property=["']og:url["']\s+content=["'][^"']*["']\s*\/?>/i,
        `<meta property="og:url" content="https://www.yourbody.fyi${route.path}" />`
      );
    }

    const outFilePath = path.resolve(distDir, route.outFile);
    fs.writeFileSync(outFilePath, html, 'utf8');
    console.log(`  ✓ ${route.path} -> dist/${route.outFile} (${renderedMarkup.length} markup bytes)`);
  }

  // Update sw.js revision for index.html using the MD5 of the final prerendered dist/index.html
  const swPath = path.resolve(distDir, 'sw.js');
  if (fs.existsSync(swPath)) {
    const finalIndexHtml = fs.readFileSync(indexHtmlPath);
    const finalHash = crypto.createHash('md5').update(finalIndexHtml).digest('hex');
    let swContent = fs.readFileSync(swPath, 'utf8');
    const updatedSw = swContent.replace(
      /\{url:"index\.html",revision:"[a-f0-9]+"\}|\{revision:"[a-f0-9]+",url:"index\.html"\}/g,
      `{url:"index.html",revision:"${finalHash}"}`
    );
    if (updatedSw !== swContent) {
      fs.writeFileSync(swPath, updatedSw, 'utf8');
      console.log(`  ✓ Updated sw.js index.html revision to ${finalHash}`);
    } else {
      console.warn('  ⚠ Could not find index.html entry in sw.js to update revision');
    }
  }

  try {
    fs.rmSync(ssrDir, { recursive: true, force: true });
  } catch {
    // Non-fatal
  }

  console.log('[prerender] Completed successfully.');
  process.exit(0);
} catch (err) {
  console.error('[prerender] Error during prerender:', err);
  process.exit(1);
}
