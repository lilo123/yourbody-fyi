/**
 * Maximum photo payload accepted for AI nutrition parsing: 1.5 MB of decoded image bytes.
 * Kept in its own module so modules in the entry chunk can import it without pulling in
 * the image compression code.
 */
export const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024; // 1,572,864 bytes
