import { useState, useRef, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import {
  compressImageBase64,
  compressImageFile,
  MAX_PHOTO_BYTES,
  type CompressedImage,
} from '../../utils/imageCompression';

export interface UseNutritionPhotoPickerOptions {
  onPhotoSelected?: (photo: CompressedImage) => void;
  onError?: (msg: string) => void;
  onClearError?: () => void;
}

export function useNutritionPhotoPicker(options?: UseNutritionPhotoPickerOptions) {
  const [selectedPhoto, setSelectedPhoto] = useState<CompressedImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePickPhoto = useCallback(
    async (source: CameraSource) => {
      try {
        const image = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Base64,
          source,
        });

        if (image.base64String) {
          const mimeType = image.format ? `image/${image.format}` : 'image/jpeg';
          const compressed = await compressImageBase64(image.base64String, mimeType);
          if (compressed && compressed.base64) {
            if (compressed.sizeBytes > MAX_PHOTO_BYTES) {
              setSelectedPhoto(null);
              options?.onError?.('Photo is too large (max 1.5 MB). Please choose a smaller photo.');
              return;
            }
            setSelectedPhoto(compressed);
            options?.onPhotoSelected?.(compressed);
            options?.onClearError?.();
          } else {
            options?.onError?.('Could not process captured photo. Please try again.');
          }
        }
      } catch (err: any) {
        const msg = (err?.message || '').toLowerCase();
        if (msg.includes('cancel')) {
          return;
        }
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
      }
    },
    [options]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const compressed = await compressImageFile(file);
        if (compressed && compressed.base64) {
          if (compressed.sizeBytes > MAX_PHOTO_BYTES) {
            setSelectedPhoto(null);
            options?.onError?.('Photo is too large (max 1.5 MB). Please choose a smaller photo.');
            return;
          }
          setSelectedPhoto(compressed);
          options?.onPhotoSelected?.(compressed);
          options?.onClearError?.();
        } else {
          options?.onError?.('Could not process selected image. Please select a valid photo.');
        }
      } catch (err) {
        console.warn('Image compression failed:', err);
        options?.onError?.('Failed to process image.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [options]
  );

  const handleRemovePhoto = useCallback(() => {
    setSelectedPhoto(null);
  }, []);

  return {
    selectedPhoto,
    setSelectedPhoto,
    fileInputRef,
    handlePickPhoto,
    handleFileChange,
    handleRemovePhoto,
  };
}
