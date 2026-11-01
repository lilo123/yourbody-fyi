import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Open Graph & Twitter Share Image Configuration', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const ogImagePath = path.join(rootDir, 'public', 'og-image.png');
  const viteConfigPath = path.join(rootDir, 'vite.config.ts');

  describe('(a) index.html Open Graph and Twitter Card tags', () => {
    it('sets og:image, dimensions, alt, and twitter card tags correctly without duplication', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      // og:title
      const ogTitleMatch = indexHtml.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
      expect(ogTitleMatch).toBeDefined();
      const ogTitle = ogTitleMatch ? ogTitleMatch[1] : '';
      expect(ogTitle).toBe('Yourbody.fyi | Fitness & Nutrition');

      // og:image
      const ogImageMatches = Array.from(indexHtml.matchAll(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/gi));
      expect(ogImageMatches.length).toBe(1);
      expect(ogImageMatches[0][1]).toBe('https://www.yourbody.fyi/og-image.png');

      // og:image:width
      const ogWidthMatches = Array.from(indexHtml.matchAll(/<meta\s+property=["']og:image:width["']\s+content=["']([^"']+)["']/gi));
      expect(ogWidthMatches.length).toBe(1);
      expect(ogWidthMatches[0][1]).toBe('1200');

      // og:image:height
      const ogHeightMatches = Array.from(indexHtml.matchAll(/<meta\s+property=["']og:image:height["']\s+content=["']([^"']+)["']/gi));
      expect(ogHeightMatches.length).toBe(1);
      expect(ogHeightMatches[0][1]).toBe('630');

      // og:image:alt (must match existing og:title copy)
      const ogAltMatches = Array.from(indexHtml.matchAll(/<meta\s+property=["']og:image:alt["']\s+content=["']([^"']+)["']/gi));
      expect(ogAltMatches.length).toBe(1);
      expect(ogAltMatches[0][1]).toBe(ogTitle);

      // twitter:card
      const twitterCardMatches = Array.from(indexHtml.matchAll(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']+)["']/gi));
      expect(twitterCardMatches.length).toBe(1);
      expect(twitterCardMatches[0][1]).toBe('summary_large_image');

      // twitter:image
      const twitterImageMatches = Array.from(indexHtml.matchAll(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/gi));
      expect(twitterImageMatches.length).toBe(1);
      expect(twitterImageMatches[0][1]).toBe('https://www.yourbody.fyi/og-image.png');
    });
  });

  describe('(b) public/og-image.png file integrity and dimensions', () => {
    it('exists and is a valid 1200x630 PNG with correct IHDR chunk bytes', () => {
      expect(fs.existsSync(ogImagePath)).toBe(true);

      const buffer = fs.readFileSync(ogImagePath);
      expect(buffer.length).toBeGreaterThan(0);

      // PNG file signature: 89 50 4E 47 0D 0A 1A 0A
      const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(buffer.subarray(0, 8)).toEqual(pngSignature);

      // First chunk is IHDR
      const ihdrChunkType = buffer.subarray(12, 16).toString('ascii');
      expect(ihdrChunkType).toBe('IHDR');

      // Width and Height in IHDR chunk (big-endian 32-bit unsigned integers)
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      expect(width).toBe(1200);
      expect(height).toBe(630);
    });
  });

  describe('(c) PWA precache exclusion in vite.config.ts', () => {
    it('excludes og-image.png from workbox globIgnores while keeping png in globPatterns', () => {
      expect(fs.existsSync(viteConfigPath)).toBe(true);
      const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');

      // Check globPatterns includes png
      expect(viteConfigContent).toMatch(/globPatterns:\s*\[[^\]]*png[^\]]*\]/);

      // Check globIgnores includes **/og-image.png
      expect(viteConfigContent).toMatch(/globIgnores:\s*\[[^\]]*['"]\*\*\/og-image\.png['"][^\]]*\]/);
    });
  });

  describe('(d) prerendered pages Open Graph image alt invariant (when dist exists)', () => {
    it('sets og:image:alt to match route og:title across all prerendered html files', () => {
      const distDir = path.join(rootDir, 'dist');
      if (!fs.existsSync(distDir)) {
        return;
      }
      for (const file of ['index.html', 'terms.html', 'privacy.html', 'refunds.html', 'login.html']) {
        const filePath = path.join(distDir, file);
        expect(fs.existsSync(filePath), `Expected prerender file ${file} to exist`).toBe(true);
        const html = fs.readFileSync(filePath, 'utf8');

        const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        const ogAltMatch = html.match(/<meta\s+property=["']og:image:alt["']\s+content=["']([^"']+)["']/i);
        expect(ogTitleMatch, `Expected og:title in ${file}`).not.toBeNull();
        expect(ogAltMatch, `Expected og:image:alt in ${file}`).not.toBeNull();
        expect(ogAltMatch?.[1], `og:image:alt in ${file} must match og:title`).toBe(ogTitleMatch?.[1]);

        const twitterAltMatch = html.match(/<meta\s+(?:name|property)=["']twitter:image:alt["']\s+content=["']([^"']+)["']/i);
        if (twitterAltMatch) {
          expect(twitterAltMatch[1], `twitter:image:alt in ${file} must match og:title`).toBe(ogTitleMatch?.[1]);
        }
      }
    });
  });
});
