/**
 * RFC 4122 UUID v4 regex pattern.
 */
export const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validates whether a value is a valid standard UUID string.
 */
export const isValidUUID = (val: unknown): val is string =>
  typeof val === 'string' && UUID_REGEX.test(val);

/**
 * Alias for isValidUUID.
 */
export const isUUID = (val: string): boolean => isValidUUID(val);
