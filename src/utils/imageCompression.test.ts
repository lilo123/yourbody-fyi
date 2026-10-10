import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateTargetDimensions,
  formatFileSize,
  cleanBase64,
  getBase64SizeBytes,
  compressImageBase64,
  compressImageFile,
  isWorkerCompressionSupported,
  setWorkerCompressionSupportedForTesting,
  resetWorkerCacheForTesting,
  MAX_PHOTO_BYTES,
  isPhotoTooLarge,
} from './imageCompression';

describe('imageCompression utils', () => {
  describe('calculateTargetDimensions', () => {
    it('returns exact dimensions if already within maxDimension', () => {
      expect(calculateTargetDimensions(800, 600, 1024)).toEqual({ width: 800, height: 600 });
      expect(calculateTargetDimensions(1024, 1024, 1024)).toEqual({ width: 1024, height: 1024 });
      expect(calculateTargetDimensions(300, 400, 1024)).toEqual({ width: 300, height: 400 });
    });

    it('scales down landscape images while preserving aspect ratio', () => {
      const { width, height } = calculateTargetDimensions(2048, 1024, 1024);
      expect(width).toBe(1024);
      expect(height).toBe(512);

      const highRes = calculateTargetDimensions(4000, 3000, 1024);
      expect(highRes.width).toBe(1024);
      expect(highRes.height).toBe(768);
    });

    it('scales down portrait images while preserving aspect ratio', () => {
      const { width, height } = calculateTargetDimensions(1024, 2048, 1024);
      expect(width).toBe(512);
      expect(height).toBe(1024);

      const highRes = calculateTargetDimensions(3000, 4000, 1024);
      expect(highRes.width).toBe(768);
      expect(highRes.height).toBe(1024);
    });

    it('scales down square images larger than max dimension', () => {
      const result = calculateTargetDimensions(2500, 2500, 1024);
      expect(result).toEqual({ width: 1024, height: 1024 });
    });

    it('handles boundary and zero/negative dimension edge cases safely', () => {
      expect(calculateTargetDimensions(0, 0, 1024)).toEqual({ width: 0, height: 0 });
      expect(calculateTargetDimensions(-100, 500, 1024)).toEqual({ width: 0, height: 0 });
      expect(calculateTargetDimensions(500, -100, 1024)).toEqual({ width: 0, height: 0 });
      expect(calculateTargetDimensions(NaN, 500, 1024)).toEqual({ width: 0, height: 0 });
      expect(calculateTargetDimensions(500, NaN, 1024)).toEqual({ width: 0, height: 0 });
      expect(calculateTargetDimensions(Infinity, 100, 1024)).toEqual({ width: 0, height: 0 });
    });

    it('handles extreme aspect ratios without division by zero or invalid dimensions', () => {
      const panorama = calculateTargetDimensions(8000, 800, 1024);
      expect(panorama.width).toBe(1024);
      expect(panorama.height).toBe(102);

      const tall = calculateTargetDimensions(800, 8000, 1024);
      expect(tall.width).toBe(102);
      expect(tall.height).toBe(1024);

      const ultraWide = calculateTargetDimensions(10000, 1, 1024);
      expect(ultraWide.width).toBe(1024);
      expect(ultraWide.height).toBe(1);

      const ultraTall = calculateTargetDimensions(1, 10000, 1024);
      expect(ultraTall.width).toBe(1);
      expect(ultraTall.height).toBe(1024);
    });
  });

  describe('formatFileSize', () => {
    it('formats bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(500)).toBe('500 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    it('formats kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(100 * 1024)).toBe('100.0 KB');
    });

    it('formats megabytes correctly', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('handles negative or NaN values safely', () => {
      expect(formatFileSize(-100)).toBe('0 B');
      expect(formatFileSize(NaN)).toBe('0 B');
      expect(formatFileSize(Infinity)).toBe('0 B');
    });
  });

  describe('cleanBase64 & getBase64SizeBytes', () => {
    it('strips data URI prefix', () => {
      const raw = 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAA';
      expect(cleanBase64(raw)).toBe('iVBORw0KGgoAAAANSUhEUgAA');

      const png = 'data:image/png;base64,ABCDEF12345';
      expect(cleanBase64(png)).toBe('ABCDEF12345');

      const clean = 'SGVsbG8gV29ybGQ=';
      expect(cleanBase64(clean)).toBe('SGVsbG8gV29ybGQ=');

      const uppercase = 'DATA:IMAGE/WEBP;BASE64,xyz123';
      expect(cleanBase64(uppercase)).toBe('xyz123');
    });

    it('handles null, undefined, and non-string inputs safely without throwing', () => {
      expect(cleanBase64('')).toBe('');
      expect(cleanBase64(null as any)).toBe('');
      expect(cleanBase64(undefined as any)).toBe('');
      expect(getBase64SizeBytes('')).toBe(0);
      expect(getBase64SizeBytes(null as any)).toBe(0);
    });

    it('computes approximate byte size for base64 with different paddings', () => {
      // 'any carnal pleasure.' in base64 is 'YW55IGNhcm5hbCBwbGVhc3VyZS4=' (20 bytes, 1 padding)
      const b64_1pad = 'YW55IGNhcm5hbCBwbGVhc3VyZS4=';
      expect(getBase64SizeBytes(b64_1pad)).toBe(20);

      // 'any carnal pleasure' in base64 is 'YW55IGNhcm5hbCBwbGVhc3VyZQ==' (19 bytes, 2 padding)
      const b64_2pad = 'YW55IGNhcm5hbCBwbGVhc3VyZQ==';
      expect(getBase64SizeBytes(b64_2pad)).toBe(19);

      // 'any carnal pleasur' in base64 is 'YW55IGNhcm5hbCBwbGVhc3Vy' (18 bytes, 0 padding)
      const b64_0pad = 'YW55IGNhcm5hbCBwbGVhc3Vy';
      expect(getBase64SizeBytes(b64_0pad)).toBe(18);
    });

    it('handles base64 with whitespace and newlines accurately', () => {
      const withNewlines = 'YW55IGNhcm5hb\r\nCBwbGVhc3VyZQ==';
      expect(getBase64SizeBytes(withNewlines)).toBe(19);
    });
  });

  describe('compressImageBase64', () => {
    it('returns structured result with base64, dataUrl, and dimensions in JSDOM', async () => {
      const sampleBase64 = 'YW55IGNhcm5hbCBwbGVhc3Vy';
      const result = await compressImageBase64(sampleBase64, 'image/jpeg', 1024);
      expect(result).toBeDefined();
      expect(result.base64).toBe(sampleBase64);
      expect(result.dataUrl).toContain('data:image/jpeg;base64,');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
    });
  });

  describe('Full Canvas 2D compression pipeline with mocks', () => {
    let originalGetContext: any;
    let originalToDataURL: any;
    let originalImage: any;
    let originalCreateObjectURL: any;
    let originalRevokeObjectURL: any;

    beforeEach(() => {
      originalGetContext = HTMLCanvasElement.prototype.getContext;
      originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      originalImage = globalThis.Image;
      originalCreateObjectURL = globalThis.URL.createObjectURL;
      originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    });

    afterEach(() => {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
      globalThis.Image = originalImage;
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it('pre-fills white background before drawImage to prevent transparent PNG turning black in JPEG conversion', async () => {
      const mockFillRect = vi.fn();
      const mockDrawImage = vi.fn();
      const mockContext = {
        fillStyle: '',
        fillRect: mockFillRect,
        drawImage: mockDrawImage,
      };

      HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((id: string) => {
        if (id === '2d') return mockContext;
        return null;
      });

      HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,Y29tcHJlc3NlZC1qcGVn');

      class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 2000;
        naturalHeight = 1000;
        width = 2000;
        height = 1000;
        private _src = '';

        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          if (val) {
            setTimeout(() => {
              if (this.onload) this.onload();
            }, 0);
          }
        }
      }

      globalThis.Image = MockImage as any;

      const result = await compressImageBase64('data:image/png;base64,dGVzdA==', 'image/png', 1024, 0.7);

      expect(mockContext.fillStyle).toBe('#FFFFFF');
      expect(mockFillRect).toHaveBeenCalledWith(0, 0, 1024, 512);
      expect(mockDrawImage).toHaveBeenCalled();
      expect(result.base64).toBe('Y29tcHJlc3NlZC1qcGVn');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(512);
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('compressImageFile utilizes zero-copy URL.createObjectURL and revokes it upon completion', async () => {
      const mockFillRect = vi.fn();
      const mockDrawImage = vi.fn();
      const mockContext = {
        fillStyle: '',
        fillRect: mockFillRect,
        drawImage: mockDrawImage,
      };

      HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((id: string) => {
        if (id === '2d') return mockContext;
        return null;
      });

      HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,ZmlsZS1jb21wcmVzc2Vk');

      const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-blob-uuid');
      const mockRevokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = mockCreateObjectURL;
      globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

      class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 1200;
        naturalHeight = 1200;
        width = 1200;
        height = 1200;
        private _src = '';

        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          if (val) {
            setTimeout(() => {
              if (this.onload) this.onload();
            }, 0);
          }
        }
      }

      globalThis.Image = MockImage as any;

      const mockBlob = new Blob(['image-bytes'], { type: 'image/png' });
      const result = await compressImageFile(mockBlob, 1024, 0.7);

      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-blob-uuid');
      expect(mockContext.fillStyle).toBe('#FFFFFF');
      expect(mockFillRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
      expect(result.base64).toBe('ZmlsZS1jb21wcmVzc2Vk');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(1024);
    });

    it('cleans up image event listeners and detaches handlers when fallback timer expires', async () => {
      vi.useFakeTimers();

      const mockFillRect = vi.fn();
      const mockContext = {
        fillStyle: '',
        fillRect: mockFillRect,
        drawImage: vi.fn(),
      };

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContext);

      const capturedImages: any[] = [];

      class StuckImage {
        onload: (() => void) | null = vi.fn();
        onerror: (() => void) | null = vi.fn();
        crossOrigin = '';
        width = 1000;
        height = 1000;
        src = '';

        constructor() {
          capturedImages.push(this);
        }
      }

      globalThis.Image = StuckImage as any;

      const promise = compressImageBase64('data:image/jpeg;base64,c3R1Y2s=', 'image/jpeg', 1024);

      // Advance time by 1000ms to trigger fallback timeout
      vi.advanceTimersByTime(1001);

      const result = await promise;
      const capturedImageInstance = capturedImages[0];

      expect(capturedImageInstance).toBeDefined();
      expect(capturedImageInstance.onload).toBeNull();
      expect(capturedImageInstance.onerror).toBeNull();
      expect(capturedImageInstance.src).toBe('');
      expect(result.base64).toBe('c3R1Y2s=');

      vi.useRealTimers();
    });

    it('returns zero dimensions and empty base64 immediately for empty inputs in compressImageBase64', async () => {
      const emptyResult = await compressImageBase64('');
      expect(emptyResult.base64).toBe('');
      expect(emptyResult.sizeBytes).toBe(0);
      expect(emptyResult.width).toBe(0);
      expect(emptyResult.height).toBe(0);

      const emptyDataUriResult = await compressImageBase64('data:image/jpeg;base64,');
      expect(emptyDataUriResult.base64).toBe('');
      expect(emptyDataUriResult.sizeBytes).toBe(0);

      const dataCommaResult = await compressImageBase64('data:,');
      expect(dataCommaResult.base64).toBe('');
      expect(dataCommaResult.sizeBytes).toBe(0);
    });

    it('handles data URIs with parameters and whitespace in cleanBase64', () => {
      expect(cleanBase64('data:image/jpeg;name=food.jpg;base64,YWJj')).toBe('YWJj');
      expect(cleanBase64('data:image/png;charset=utf-8;base64,eHl6')).toBe('eHl6');
      expect(cleanBase64('data:;base64,MTIz')).toBe('MTIz');
      expect(cleanBase64('data:,')).toBe('');
    });

    it('returns zero dimensions and empty strings immediately for 0-byte or null file in compressImageFile', async () => {
      const emptyBlob = new Blob([], { type: 'image/jpeg' });
      const result = await compressImageFile(emptyBlob);
      expect(result.base64).toBe('');
      expect(result.sizeBytes).toBe(0);
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
    });

    it('compressImageFile detaches listeners and revokes object URL on error', async () => {
      const mockFillRect = vi.fn();
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        fillStyle: '',
        fillRect: mockFillRect,
        drawImage: vi.fn(),
      });

      const mockRevokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-error-blob');
      globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

      const capturedErrors: any[] = [];
      class ErrorImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        width = 0;
        height = 0;
        private _src = '';

        constructor() {
          capturedErrors.push(this);
        }

        get src() {
          return this._src;
        }
        set src(val: string) {
          this._src = val;
          if (val) {
            setTimeout(() => {
              if (this.onerror) this.onerror();
            }, 0);
          }
        }
      }

      globalThis.Image = ErrorImage as any;

      const mockBlob = new Blob(['bad-image-data'], { type: 'image/png' });
      const result = await compressImageFile(mockBlob, 1024, 0.7);
      const capturedErrorImg = capturedErrors[0];

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-error-blob');
      expect(capturedErrorImg.onload).toBeNull();
      expect(capturedErrorImg.onerror).toBeNull();
      expect(capturedErrorImg.src).toBe('');
      expect(result.base64).toBe('');
      expect(result.sizeBytes).toBe(0);
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
    });

    it('compressImageFile falls back gracefully when URL.createObjectURL throws', async () => {
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      });

      globalThis.URL.createObjectURL = vi.fn().mockImplementation(() => {
        throw new Error('createObjectURL not supported');
      });

      const mockBlob = new Blob(['fallback-bytes'], { type: 'image/jpeg' });
      const result = await compressImageFile(mockBlob, 1024, 0.7);

      expect(result).toBeDefined();
      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('Worker and OffscreenCanvas detection and off-thread execution', () => {
    let originalWorker: any;
    let originalOffscreenCanvas: any;
    let originalCreateImageBitmap: any;
    let originalCreateObjectURL: any;
    let originalRevokeObjectURL: any;
    let originalGetContext: any;
    let originalToDataURL: any;
    let originalImage: any;

    beforeEach(() => {
      originalWorker = (globalThis as any).Worker;
      originalOffscreenCanvas = (globalThis as any).OffscreenCanvas;
      originalCreateImageBitmap = (globalThis as any).createImageBitmap;
      originalCreateObjectURL = globalThis.URL.createObjectURL;
      originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
      originalGetContext = HTMLCanvasElement.prototype.getContext;
      originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      originalImage = globalThis.Image;
      resetWorkerCacheForTesting();
    });

    afterEach(() => {
      (globalThis as any).Worker = originalWorker;
      (globalThis as any).OffscreenCanvas = originalOffscreenCanvas;
      (globalThis as any).createImageBitmap = originalCreateImageBitmap;
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
      globalThis.Image = originalImage;
      resetWorkerCacheForTesting();
      vi.restoreAllMocks();
    });

    it('detects lack of worker support in default JSDOM environment', () => {
      expect(isWorkerCompressionSupported()).toBe(false);
    });

    it('returns false when Worker is defined but OffscreenCanvas is missing', () => {
      (globalThis as any).Worker = class {};
      (globalThis as any).OffscreenCanvas = undefined;
      (globalThis as any).createImageBitmap = vi.fn();
      expect(isWorkerCompressionSupported()).toBe(false);
    });

    it('returns false when OffscreenCanvas is defined but 2D context is unsupported', () => {
      (globalThis as any).Worker = class {};
      (globalThis as any).OffscreenCanvas = class {
        getContext() {
          return null;
        }
        convertToBlob = vi.fn();
      };
      (globalThis as any).createImageBitmap = vi.fn();
      expect(isWorkerCompressionSupported()).toBe(false);
    });

    it('returns false when OffscreenCanvas convertToBlob is missing', () => {
      (globalThis as any).Worker = class {};
      (globalThis as any).OffscreenCanvas = class {
        getContext() {
          return {};
        }
      };
      (globalThis as any).createImageBitmap = vi.fn();
      expect(isWorkerCompressionSupported()).toBe(false);
    });

    it('returns true when Worker, OffscreenCanvas 2D context, and createImageBitmap are available', () => {
      (globalThis as any).Worker = class {};
      (globalThis as any).OffscreenCanvas = class {
        getContext(id: string) {
          if (id === '2d') return {};
          return null;
        }
        convertToBlob = vi.fn();
      };
      (globalThis as any).createImageBitmap = vi.fn();
      expect(isWorkerCompressionSupported()).toBe(true);
    });

    it('respects setWorkerCompressionSupportedForTesting override', () => {
      setWorkerCompressionSupportedForTesting(true);
      expect(isWorkerCompressionSupported()).toBe(true);
      setWorkerCompressionSupportedForTesting(false);
      expect(isWorkerCompressionSupported()).toBe(false);
      setWorkerCompressionSupportedForTesting(null);
    });

    it('executes compressImageFile via Worker when supported and terminates worker after completion', async () => {
      setWorkerCompressionSupportedForTesting(true);

      const mockTerminate = vi.fn();
      let postedData: any = null;

      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        terminate = mockTerminate;
        postMessage = vi.fn((data: any) => {
          postedData = data;
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  id: data.id,
                  success: true,
                  result: {
                    base64: 'd29ya2VyLWNvbXByZXNzZWQ=',
                    dataUrl: 'data:image/jpeg;base64,d29ya2VyLWNvbXByZXNzZWQ=',
                    mimeType: 'image/jpeg',
                    sizeBytes: 1234,
                    width: 800,
                    height: 600,
                  },
                },
              } as MessageEvent);
            }
          }, 0);
        });
      }

      (globalThis as any).Worker = MockWorker;
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/worker-script');

      const mockBlob = new Blob(['athlete-photo-bytes'], { type: 'image/jpeg' });
      const result = await compressImageFile(mockBlob, 1024, 0.8);

      expect(postedData).toBeDefined();
      expect(postedData.blob).toBe(mockBlob);
      expect(postedData.maxDimension).toBe(1024);
      expect(postedData.quality).toBe(0.8);
      expect(result.base64).toBe('d29ya2VyLWNvbXByZXNzZWQ=');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(mockTerminate).toHaveBeenCalled();
    });

    it('executes compressImageBase64 via Worker when supported and terminates worker after completion', async () => {
      setWorkerCompressionSupportedForTesting(true);

      const mockTerminate = vi.fn();
      let postedData: any = null;

      class MockWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        terminate = mockTerminate;
        postMessage = vi.fn((data: any) => {
          postedData = data;
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  id: data.id,
                  success: true,
                  result: {
                    base64: 'YmFzZTY0LXdvcmtlci1yZXN1bHQ=',
                    dataUrl: 'data:image/jpeg;base64,YmFzZTY0LXdvcmtlci1yZXN1bHQ=',
                    mimeType: 'image/jpeg',
                    sizeBytes: 5678,
                    width: 1024,
                    height: 768,
                  },
                },
              } as MessageEvent);
            }
          }, 0);
        });
      }

      (globalThis as any).Worker = MockWorker;
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/worker-script');

      const result = await compressImageBase64('data:image/jpeg;base64,c291cmNl', 'image/jpeg', 1024, 0.7);

      expect(postedData).toBeDefined();
      expect(postedData.base64).toBe('c291cmNl');
      expect(result.base64).toBe('YmFzZTY0LXdvcmtlci1yZXN1bHQ=');
      expect(result.width).toBe(1024);
      expect(result.height).toBe(768);
      expect(mockTerminate).toHaveBeenCalled();
    });

    it('gracefully falls back to main-thread canvas when Worker encounters runtime error', async () => {
      setWorkerCompressionSupportedForTesting(true);

      const mockTerminate = vi.fn();

      class FailingWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        terminate = mockTerminate;
        postMessage = vi.fn((data: any) => {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: {
                  id: data.id,
                  success: false,
                  error: 'OffscreenCanvas memory allocation failure',
                },
              } as MessageEvent);
            }
          }, 0);
        });
      }

      (globalThis as any).Worker = FailingWorker;
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/worker-script');

      // Mock canvas for main-thread fallback
      const mockFillRect = vi.fn();
      const mockDrawImage = vi.fn();
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        fillStyle: '',
        fillRect: mockFillRect,
        drawImage: mockDrawImage,
      });
      HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,ZmFsbGJhY2stcmVzdWx0');

      class MockImg {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 1000;
        naturalHeight = 1000;
        width = 1000;
        height = 1000;
        private _src = '';
        get src() { return this._src; }
        set src(v: string) {
          this._src = v;
          if (v) setTimeout(() => { if (this.onload) this.onload(); }, 0);
        }
      }
      globalThis.Image = MockImg as any;

      const mockBlob = new Blob(['photo-bytes'], { type: 'image/jpeg' });
      const result = await compressImageFile(mockBlob, 1024, 0.7);

      expect(mockTerminate).toHaveBeenCalled();
      expect(result.base64).toBe('ZmFsbGJhY2stcmVzdWx0');
      expect(mockDrawImage).toHaveBeenCalled();
    });

    it('gracefully falls back to main-thread canvas when Worker constructor throws (e.g. CSP violation)', async () => {
      setWorkerCompressionSupportedForTesting(true);

      (globalThis as any).Worker = class {
        constructor() {
          throw new Error('SecurityError: Worker creation blocked by Content-Security-Policy');
        }
      };
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/worker-script');

      // Mock canvas for main-thread fallback
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      });
      HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,Y3NwLWZhbGxiYWNr');

      class MockImg {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 500;
        naturalHeight = 500;
        width = 500;
        height = 500;
        private _src = '';
        get src() { return this._src; }
        set src(v: string) {
          this._src = v;
          if (v) setTimeout(() => { if (this.onload) this.onload(); }, 0);
        }
      }
      globalThis.Image = MockImg as any;

      const result = await compressImageBase64('data:image/jpeg;base64,dGVzdA==', 'image/jpeg', 1024, 0.7);
      expect(result.base64).toBe('Y3NwLWZhbGxiYWNr');
    });

    it('terminates worker and falls back when worker execution exceeds timeout', async () => {
      vi.useFakeTimers();
      setWorkerCompressionSupportedForTesting(true);

      const mockTerminate = vi.fn();

      class StalledWorker {
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        terminate = mockTerminate;
        postMessage = vi.fn(); // Never responds
      }

      (globalThis as any).Worker = StalledWorker;
      globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/worker-script');

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      });
      HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,dGltZW91dC1mYWxsYmFjaw==');

      class MockImg {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        crossOrigin = '';
        naturalWidth = 600;
        naturalHeight = 600;
        width = 600;
        height = 600;
        private _src = '';
        get src() { return this._src; }
        set src(v: string) {
          this._src = v;
          if (v) setTimeout(() => { if (this.onload) this.onload(); }, 0);
        }
      }
      globalThis.Image = MockImg as any;

      const promise = compressImageBase64('data:image/jpeg;base64,c3RhbGw=', 'image/jpeg', 1024, 0.7);

      // Fast forward past worker timeout (5000ms)
      await vi.advanceTimersByTimeAsync(5001);
      // Fast forward main thread onload
      await vi.advanceTimersByTimeAsync(50);

      const result = await promise;
      expect(mockTerminate).toHaveBeenCalled();
      expect(result.base64).toBe('dGltZW91dC1mYWxsYmFjaw==');

      vi.useRealTimers();
    });
  });

  describe('MAX_PHOTO_BYTES and isPhotoTooLarge', () => {
    it('defines 1.5 MB photo payload cap constant', () => {
      expect(MAX_PHOTO_BYTES).toBe(1.5 * 1024 * 1024);
      expect(MAX_PHOTO_BYTES).toBe(1572864);
    });

    it('correctly identifies payloads that exceed or stay within cap', () => {
      expect(isPhotoTooLarge(MAX_PHOTO_BYTES)).toBe(false);
      expect(isPhotoTooLarge(MAX_PHOTO_BYTES - 1)).toBe(false);
      expect(isPhotoTooLarge(MAX_PHOTO_BYTES + 1)).toBe(true);

      expect(
        isPhotoTooLarge({
          base64: 'abc',
          dataUrl: 'data:image/jpeg;base64,abc',
          mimeType: 'image/jpeg',
          sizeBytes: MAX_PHOTO_BYTES,
          width: 800,
          height: 600,
        })
      ).toBe(false);

      expect(
        isPhotoTooLarge({
          base64: 'abc',
          dataUrl: 'data:image/jpeg;base64,abc',
          mimeType: 'image/jpeg',
          sizeBytes: MAX_PHOTO_BYTES + 100,
          width: 800,
          height: 600,
        })
      ).toBe(true);
    });
  });
});
