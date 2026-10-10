import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Camera, CameraSource } from '@capacitor/camera';
import { useNutritionPhotoPicker } from './useNutritionPhotoPicker';
import {
  compressImageBase64,
  compressImageFile,
  MAX_PHOTO_BYTES,
} from '../../utils/imageCompression';

vi.mock('@capacitor/camera', () => ({
  Camera: {
    getPhoto: vi.fn(),
  },
  CameraResultType: {
    Base64: 'base64',
  },
  CameraSource: {
    Camera: 'CAMERA',
    Photos: 'PHOTOS',
  },
}));

vi.mock('../../utils/imageCompression', async () => {
  const actual = await vi.importActual<typeof import('../../utils/imageCompression')>(
    '../../utils/imageCompression'
  );
  return {
    ...actual,
    compressImageBase64: vi.fn(),
    compressImageFile: vi.fn(),
  };
});

describe('useNutritionPhotoPicker', () => {
  const mockOnPhotoSelected = vi.fn();
  const mockOnError = vi.fn();
  const mockOnClearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects valid camera photo within 1.5 MB cap', async () => {
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'valid-base64',
      format: 'jpeg',
    });
    (compressImageBase64 as any).mockResolvedValue({
      base64: 'compressed-base64',
      dataUrl: 'data:image/jpeg;base64,compressed-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 250 * 1024,
      width: 1024,
      height: 768,
    });

    const { result } = renderHook(() =>
      useNutritionPhotoPicker({
        onPhotoSelected: mockOnPhotoSelected,
        onError: mockOnError,
        onClearError: mockOnClearError,
      })
    );

    await act(async () => {
      await result.current.handlePickPhoto(CameraSource.Camera);
    });

    expect(result.current.selectedPhoto).toEqual({
      base64: 'compressed-base64',
      dataUrl: 'data:image/jpeg;base64,compressed-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 250 * 1024,
      width: 1024,
      height: 768,
    });
    expect(mockOnPhotoSelected).toHaveBeenCalledWith(result.current.selectedPhoto);
    expect(mockOnClearError).toHaveBeenCalled();
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it('rejects oversized camera photo exceeding 1.5 MB cap and notifies caller', async () => {
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'huge-base64',
      format: 'jpeg',
    });
    (compressImageBase64 as any).mockResolvedValue({
      base64: 'huge-uncompressed-base64',
      dataUrl: 'data:image/jpeg;base64,huge-uncompressed-base64',
      mimeType: 'image/jpeg',
      sizeBytes: MAX_PHOTO_BYTES + 50000,
      width: 4032,
      height: 3024,
    });

    const { result } = renderHook(() =>
      useNutritionPhotoPicker({
        onPhotoSelected: mockOnPhotoSelected,
        onError: mockOnError,
        onClearError: mockOnClearError,
      })
    );

    await act(async () => {
      await result.current.handlePickPhoto(CameraSource.Camera);
    });

    expect(result.current.selectedPhoto).toBeNull();
    expect(mockOnPhotoSelected).not.toHaveBeenCalled();
    expect(mockOnError).toHaveBeenCalledWith('Photo is too large (max 1.5 MB). Please choose a smaller photo.');
  });

  it('selects valid file within 1.5 MB cap', async () => {
    const mockFile = new File(['mock content'], 'meal.jpg', { type: 'image/jpeg' });
    (compressImageFile as any).mockResolvedValue({
      base64: 'file-compressed-base64',
      dataUrl: 'data:image/jpeg;base64,file-compressed-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 180 * 1024,
      width: 1024,
      height: 1024,
    });

    const { result } = renderHook(() =>
      useNutritionPhotoPicker({
        onPhotoSelected: mockOnPhotoSelected,
        onError: mockOnError,
        onClearError: mockOnClearError,
      })
    );

    const event = {
      target: {
        files: [mockFile],
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileChange(event);
    });

    expect(result.current.selectedPhoto).toEqual({
      base64: 'file-compressed-base64',
      dataUrl: 'data:image/jpeg;base64,file-compressed-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 180 * 1024,
      width: 1024,
      height: 1024,
    });
    expect(mockOnPhotoSelected).toHaveBeenCalledWith(result.current.selectedPhoto);
    expect(mockOnClearError).toHaveBeenCalled();
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it('rejects oversized file (e.g. uncompressed fallback) exceeding 1.5 MB cap', async () => {
    const mockFile = new File(['large photo content'], 'large.jpg', { type: 'image/jpeg' });
    (compressImageFile as any).mockResolvedValue({
      base64: 'huge-file-base64',
      dataUrl: 'data:image/jpeg;base64,huge-file-base64',
      mimeType: 'image/jpeg',
      sizeBytes: 2 * 1024 * 1024, // 2 MB
      width: 3840,
      height: 2160,
    });

    const { result } = renderHook(() =>
      useNutritionPhotoPicker({
        onPhotoSelected: mockOnPhotoSelected,
        onError: mockOnError,
        onClearError: mockOnClearError,
      })
    );

    const event = {
      target: {
        files: [mockFile],
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileChange(event);
    });

    expect(result.current.selectedPhoto).toBeNull();
    expect(mockOnPhotoSelected).not.toHaveBeenCalled();
    expect(mockOnError).toHaveBeenCalledWith('Photo is too large (max 1.5 MB). Please choose a smaller photo.');
  });

  it('handleRemovePhoto clears currently selected photo', async () => {
    (Camera.getPhoto as any).mockResolvedValue({
      base64String: 'test',
      format: 'jpeg',
    });
    (compressImageBase64 as any).mockResolvedValue({
      base64: 'test',
      dataUrl: 'data:image/jpeg;base64,test',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      width: 100,
      height: 100,
    });

    const { result } = renderHook(() => useNutritionPhotoPicker());

    await act(async () => {
      await result.current.handlePickPhoto(CameraSource.Camera);
    });
    expect(result.current.selectedPhoto).not.toBeNull();

    act(() => {
      result.current.handleRemovePhoto();
    });
    expect(result.current.selectedPhoto).toBeNull();
  });
});
