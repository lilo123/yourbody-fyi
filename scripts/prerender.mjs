#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

try {
  fs.rmSync(ssrDir, { recursive: true, force: true });
} catch {
  // Non-fatal
}

console.log('[prerender] Completed successfully.');
