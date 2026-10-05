export interface CompressedImage {
  base64: string; // Clean base64 string without data URI prefix
  dataUrl: string; // Full data:image/...;base64,... URI for rendering
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export function cleanBase64(base64OrDataUrl: string): string {
  if (!base64OrDataUrl || typeof base64OrDataUrl !== 'string') return '';
  if (base64OrDataUrl === 'data:,' || base64OrDataUrl.startsWith('data:,')) return '';
  return base64OrDataUrl.replace(/^data:[^,]*;base64,/i, '').trim();
}

export function getBase64SizeBytes(base64: string): number {
  const clean = cleanBase64(base64).replace(/\s/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes) || !Number.isFinite(bytes)) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension = 1024
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  if (width >= height) {
    const targetWidth = maxDimension;
    const targetHeight = Math.round((height * maxDimension) / width);
    return { width: targetWidth, height: Math.max(1, targetHeight) };
  } else {
    const targetHeight = maxDimension;
    const targetWidth = Math.round((width * maxDimension) / height);
    return { width: Math.max(1, targetWidth), height: targetHeight };
  }
}

/**
 * Self-contained Web Worker script for off-thread image decoding and compression.
 * Leverages createImageBitmap and OffscreenCanvas to eliminate main-thread blocking during camera capture.
 */
const WORKER_SCRIPT = `
self.onmessage = async function(e) {
  var id = e.data.id;
  var blob = e.data.blob;
  var base64 = e.data.base64;
  var mimeType = e.data.mimeType || 'image/jpeg';
  var maxDimension = e.data.maxDimension || 1024;
  var quality = typeof e.data.quality === 'number' ? e.data.quality : 0.7;

  function calculateTargetDimensions(width, height, maxDim) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return { width: 0, height: 0 };
    }
    if (width <= maxDim && height <= maxDim) {
      return { width: Math.round(width), height: Math.round(height) };
    }
    if (width >= height) {
      var targetWidth = maxDim;
      var targetHeight = Math.round((height * maxDim) / width);
      return { width: targetWidth, height: Math.max(1, targetHeight) };
    } else {
      var targetHeight = maxDim;
      var targetWidth = Math.round((width * maxDim) / height);
      return { width: Math.max(1, targetWidth), height: targetHeight };
    }
  }

  function cleanBase64(str) {
    if (!str || typeof str !== 'string') return '';
    if (str === 'data:,' || str.startsWith('data:,')) return '';
    return str.replace(/^data:[^,]*;base64,/i, '').trim();
  }

  function getBase64SizeBytes(clean) {
    var stripped = clean.replace(/\\s/g, '');
    if (!stripped) return 0;
    var padding = stripped.endsWith('==') ? 2 : stripped.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((stripped.length * 3) / 4) - padding);
  }

  try {
    var sourceBlob = blob;
    if (!sourceBlob && base64) {
      var clean = cleanBase64(base64);
      if (!clean) {
        self.postMessage({
          id: id,
          success: true,
          result: { base64: '', dataUrl: '', mimeType: mimeType, sizeBytes: 0, width: 0, height: 0 }
        });
        return;
      }
      var byteChars = atob(clean);
      var byteArrays = [];
      var sliceSize = 1024;
      for (var offset = 0; offset < byteChars.length; offset += sliceSize) {
        var slice = byteChars.slice(offset, offset + sliceSize);
        var byteNumbers = new Uint8Array(slice.length);
        for (var i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(byteNumbers);
      }
      sourceBlob = new Blob(byteArrays, { type: mimeType });
    }

    if (!sourceBlob || sourceBlob.size === 0) {
      self.postMessage({
        id: id,
        success: true,
        result: { base64: '', dataUrl: '', mimeType: mimeType, sizeBytes: 0, width: 0, height: 0 }
      });
      return;
    }

    var bitmap;
    try {
      bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(sourceBlob);
    }

    var target = calculateTargetDimensions(bitmap.width, bitmap.height, maxDimension);

    if (target.width === 0 || target.height === 0) {
      bitmap.close();
      var emptyDataUrl = '';
      if (base64) {
        emptyDataUrl = 'data:' + mimeType + ';base64,' + cleanBase64(base64);
      } else if (sourceBlob) {
        if (typeof FileReaderSync !== 'undefined') {
          emptyDataUrl = new FileReaderSync().readAsDataURL(sourceBlob);
        }
      }
      var emptyClean = cleanBase64(emptyDataUrl);
      self.postMessage({
        id: id,
        success: true,
        result: {
          base64: emptyClean,
          dataUrl: emptyDataUrl,
          mimeType: mimeType,
          sizeBytes: sourceBlob ? sourceBlob.size : getBase64SizeBytes(emptyClean),
          width: 0,
          height: 0,
        }
      });
      return;
    }

    var canvas = new OffscreenCanvas(target.width, target.height);
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('OffscreenCanvas 2D context unavailable');
    }

    // Fill background with white to prevent transparent PNG pixels turning solid black on JPEG conversion
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close();

    var outputMime = 'image/jpeg';
    var outputBlob = await canvas.convertToBlob({ type: outputMime, quality: quality });

    var dataUrl = '';
    if (typeof FileReaderSync !== 'undefined') {
      var reader = new FileReaderSync();
      dataUrl = reader.readAsDataURL(outputBlob);
    } else if (typeof FileReader !== 'undefined') {
      dataUrl = await new Promise(function(res, rej) {
        var r = new FileReader();
        r.onload = function() { res(r.result); };
        r.onerror = function() { rej(r.error || new Error('FileReader failed')); };
        r.readAsDataURL(outputBlob);
      });
    } else {
      var buffer = await outputBlob.arrayBuffer();
      var bytes = new Uint8Array(buffer);
      var binary = '';
      var chunkSize = 8192;
      for (var j = 0; j < bytes.length; j += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, j + chunkSize)));
      }
      dataUrl = 'data:' + outputMime + ';base64,' + btoa(binary);
    }

    var compressedClean = cleanBase64(dataUrl);
    var sizeBytes = outputBlob.size || getBase64SizeBytes(compressedClean);

    self.postMessage({
      id: id,
      success: true,
      result: {
        base64: compressedClean,
        dataUrl: dataUrl,
        mimeType: outputMime,
        sizeBytes: sizeBytes,
        width: target.width,
        height: target.height,
      }
    });
  } catch (err) {
    self.postMessage({
      id: id,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
`;

let isWorkerSupportedOverride: boolean | null = null;
let cachedWorkerBlobUrl: string | null = null;

/** For unit tests to force enable or disable worker path */
export function setWorkerCompressionSupportedForTesting(value: boolean | null): void {
  isWorkerSupportedOverride = value;
}

/** For unit tests to clear worker blob url cache and reset overrides */
export function resetWorkerCacheForTesting(): void {
  if (cachedWorkerBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(cachedWorkerBlobUrl);
    } catch {
      // ignore
    }
  }
  cachedWorkerBlobUrl = null;
  isWorkerSupportedOverride = null;
}

/** Feature detects Worker and OffscreenCanvas support */
export function isWorkerCompressionSupported(): boolean {
  if (isWorkerSupportedOverride !== null) {
    return isWorkerSupportedOverride;
  }
  try {
    if (
      typeof window === 'undefined' ||
      typeof Worker === 'undefined' ||
      typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return false;
    }
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    return Boolean(ctx && typeof canvas.convertToBlob === 'function');
  } catch {
    return false;
  }
}

/** Executes image compression in an isolated background Web Worker */
export function compressWithWorker(
  payload: { blob?: Blob; base64?: string; mimeType?: string; maxDimension: number; quality: number },
  timeoutMs = 5000
): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
    };

    try {
      if (!cachedWorkerBlobUrl) {
        const scriptBlob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
        cachedWorkerBlobUrl = URL.createObjectURL(scriptBlob);
      }
      worker = new Worker(cachedWorkerBlobUrl);

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Worker compression timed out'));
      }, timeoutMs);

      worker.onmessage = (e: MessageEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (e.data && e.data.success && e.data.result) {
          resolve(e.data.result);
        } else {
          reject(new Error(e.data?.error || 'Worker compression failed'));
        }
      };

      worker.onerror = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(err.message || 'Worker error'));
      };

      worker.postMessage({
        id: Math.random().toString(36).substring(2),
        ...payload,
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Synchronous 2D canvas compression on the main thread (retained as fallback) */
export async function compressImageBase64MainThread(
  base64OrDataUrl: string,
  mimeType = 'image/jpeg',
  maxDimension = 1024,
  quality = 0.7
): Promise<CompressedImage> {
  const clean = cleanBase64(base64OrDataUrl);
  if (!clean) {
    return {
      base64: '',
      dataUrl: '',
      mimeType,
      sizeBytes: 0,
      width: 0,
      height: 0,
    };
  }

  const dataUrl = base64OrDataUrl.startsWith('data:')
    ? base64OrDataUrl
    : `data:${mimeType};base64,${clean}`;

  const fallbackSizeBytes = getBase64SizeBytes(clean);

  // If in SSR, non-browser, or environment without 2D canvas support (e.g. JSDOM), return safely
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    !document.createElement('canvas').getContext?.('2d')
  ) {
    return {
      base64: clean,
      dataUrl,
      mimeType,
      sizeBytes: fallbackSizeBytes,
      width: maxDimension,
      height: maxDimension,
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const cleanupImg = () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
    };

    const finish = (result: CompressedImage) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanupImg();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        base64: clean,
        dataUrl,
        mimeType,
        sizeBytes: fallbackSizeBytes,
        width: maxDimension,
        height: maxDimension,
      });
    }, 1000);

    img.onload = () => {
      const origWidth = img.naturalWidth || img.width;
      const origHeight = img.naturalHeight || img.height;
      const target = calculateTargetDimensions(origWidth, origHeight, maxDimension);

      if (target.width === 0 || target.height === 0) {
        finish({
          base64: clean,
          dataUrl,
          mimeType,
          sizeBytes: fallbackSizeBytes,
          width: 0,
          height: 0,
        });
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          finish({
            base64: clean,
            dataUrl,
            mimeType,
            sizeBytes: fallbackSizeBytes,
            width: target.width,
            height: target.height,
          });
          return;
        }

        // Fill background with white to prevent transparent PNG pixels turning solid black on JPEG conversion
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, target.width, target.height);

        ctx.drawImage(img, 0, 0, target.width, target.height);
        const outputMime = 'image/jpeg';
        const compressedDataUrl = canvas.toDataURL(outputMime, quality);
        const compressedClean = cleanBase64(compressedDataUrl);
        const sizeBytes = getBase64SizeBytes(compressedClean);

        finish({
          base64: compressedClean,
          dataUrl: compressedDataUrl,
          mimeType: outputMime,
          sizeBytes,
          width: target.width,
          height: target.height,
        });
      } catch {
        finish({
          base64: clean,
          dataUrl,
          mimeType,
          sizeBytes: fallbackSizeBytes,
          width: target.width,
          height: target.height,
        });
      }
    };

    img.onerror = () => {
      finish({
        base64: clean,
        dataUrl,
        mimeType,
        sizeBytes: fallbackSizeBytes,
        width: maxDimension,
        height: maxDimension,
      });
    };

    img.src = dataUrl;
  });
}

/** Synchronous 2D canvas compression on the main thread for files (retained as fallback) */
export async function compressImageFileMainThread(
  file: File | Blob,
  maxDimension = 1024,
  quality = 0.7
): Promise<CompressedImage> {
  const mimeType = file?.type || 'image/jpeg';

  if (!file || file.size === 0) {
    return {
      base64: '',
      dataUrl: '',
      mimeType,
      sizeBytes: 0,
      width: 0,
      height: 0,
    };
  }

  // Fallback for SSR or environments without Canvas 2D or createObjectURL support
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    !document.createElement('canvas').getContext?.('2d') ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        compressImageBase64(result, mimeType, maxDimension, quality)
          .then(resolve)
          .catch(reject);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve) => {
    let resolved = false;
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      // Fallback if createObjectURL throws
      const reader = new FileReader();
      reader.onload = () => {
        compressImageBase64(reader.result as string, mimeType, maxDimension, quality).then(resolve);
      };
      reader.onerror = () => {
        resolve({
          base64: '',
          dataUrl: '',
          mimeType,
          sizeBytes: 0,
          width: 0,
          height: 0,
        });
      };
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      img.src = '';
      if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore revoke error
        }
      }
    };

    const finish = (result: CompressedImage) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const clean = cleanBase64(res);
        finish({
          base64: clean,
          dataUrl: res,
          mimeType,
          sizeBytes: getBase64SizeBytes(clean),
          width: maxDimension,
          height: maxDimension,
        });
      };
      reader.onerror = () => {
        finish({
          base64: '',
          dataUrl: '',
          mimeType,
          sizeBytes: 0,
          width: 0,
          height: 0,
        });
      };
      reader.readAsDataURL(file);
    }, 1000);

    img.onload = () => {
      const origWidth = img.naturalWidth || img.width;
      const origHeight = img.naturalHeight || img.height;
      const target = calculateTargetDimensions(origWidth, origHeight, maxDimension);

      if (target.width === 0 || target.height === 0) {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const clean = cleanBase64(res);
          finish({
            base64: clean,
            dataUrl: res,
            mimeType,
            sizeBytes: getBase64SizeBytes(clean),
            width: 0,
            height: 0,
          });
        };
        reader.onerror = () => {
          finish({
            base64: '',
            dataUrl: '',
            mimeType,
            sizeBytes: 0,
            width: 0,
            height: 0,
          });
        };
        reader.readAsDataURL(file);
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          throw new Error('Canvas 2D context unavailable');
        }

        // Prevent transparent PNG converting to black JPEG artifact
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, target.width, target.height);

        ctx.drawImage(img, 0, 0, target.width, target.height);
        const outputMime = 'image/jpeg';
        const compressedDataUrl = canvas.toDataURL(outputMime, quality);
        const compressedClean = cleanBase64(compressedDataUrl);
        const sizeBytes = getBase64SizeBytes(compressedClean);

        finish({
          base64: compressedClean,
          dataUrl: compressedDataUrl,
          mimeType: outputMime,
          sizeBytes,
          width: target.width,
          height: target.height,
        });
      } catch {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const clean = cleanBase64(res);
          finish({
            base64: clean,
            dataUrl: res,
            mimeType,
            sizeBytes: getBase64SizeBytes(clean),
            width: target.width || maxDimension,
            height: target.height || maxDimension,
          });
        };
        reader.onerror = () => {
          finish({
            base64: '',
            dataUrl: '',
            mimeType,
            sizeBytes: 0,
            width: 0,
            height: 0,
          });
        };
        reader.readAsDataURL(file);
      }
    };

    img.onerror = () => {
      finish({
        base64: '',
        dataUrl: '',
        mimeType,
        sizeBytes: 0,
        width: 0,
        height: 0,
      });
    };

    img.src = objectUrl;
  });
}

/**
 * Primary compression interface for base64 / dataUrl inputs.
 * Executes via Web Worker / OffscreenCanvas when supported; falls back to synchronous 2D canvas on main thread.
 */
export async function compressImageBase64(
  base64OrDataUrl: string,
  mimeType = 'image/jpeg',
  maxDimension = 1024,
  quality = 0.7
): Promise<CompressedImage> {
  const clean = cleanBase64(base64OrDataUrl);
  if (!clean) {
    return {
      base64: '',
      dataUrl: '',
      mimeType,
      sizeBytes: 0,
      width: 0,
      height: 0,
    };
  }

  // 1. Off-thread Web Worker + OffscreenCanvas path if supported
  if (isWorkerCompressionSupported()) {
    try {
      return await compressWithWorker({
        base64: clean,
        mimeType,
        maxDimension,
        quality,
      });
    } catch {
      // Worker failed or timed out: fall through to synchronous 2D canvas fallback
    }
  }

  // 2. Synchronous 2D canvas fallback path (JSDOM, SSR, or unsupported environments)
  return compressImageBase64MainThread(base64OrDataUrl, mimeType, maxDimension, quality);
}

/**
 * Primary compression interface for File / Blob inputs.
 * Executes via Web Worker / OffscreenCanvas when supported; falls back to synchronous 2D canvas on main thread.
 */
export async function compressImageFile(
  file: File | Blob,
  maxDimension = 1024,
  quality = 0.7
): Promise<CompressedImage> {
  const mimeType = file?.type || 'image/jpeg';

  if (!file || file.size === 0) {
    return {
      base64: '',
      dataUrl: '',
      mimeType,
      sizeBytes: 0,
      width: 0,
      height: 0,
    };
  }

  // 1. Off-thread Web Worker + OffscreenCanvas path if supported
  if (isWorkerCompressionSupported()) {
    try {
      return await compressWithWorker({
        blob: file,
        mimeType,
        maxDimension,
        quality,
      });
    } catch {
      // Worker failed or timed out: fall through to main-thread fallback
    }
  }

  // 2. Synchronous 2D canvas fallback path (JSDOM, SSR, or unsupported environments)
  return compressImageFileMainThread(file, maxDimension, quality);
}
