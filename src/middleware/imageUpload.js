import multer from 'multer';

export const ALLOWED_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const DEFAULT_MAX_IMAGE_BYTES = Math.floor(3.5 * 1024 * 1024);

export const getMaxImageBytes = () => {
  const configured = Number(process.env.ROBOFLOW_MAX_IMAGE_BYTES);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_IMAGE_BYTES;
};

const normalizedMimeType = (mimeType) => mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

export const detectImageMimeType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  ) return 'image/jpeg';

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png';

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';

  return null;
};

export const validateUploadedImage = (file) => {
  if (!file?.buffer?.length) {
    const error = new Error('No image file provided');
    error.statusCode = 400;
    error.code = 'IMAGE_REQUIRED';
    throw error;
  }

  const declaredType = normalizedMimeType(file.mimetype);
  const detectedType = detectImageMimeType(file.buffer);

  if (!ALLOWED_IMAGE_TYPES.includes(declaredType) || !detectedType || declaredType !== detectedType) {
    const error = new Error('Invalid image. Upload a genuine JPEG, PNG, or WebP file.');
    error.statusCode = 415;
    error.code = 'UNSUPPORTED_IMAGE_TYPE';
    throw error;
  }

  return detectedType;
};

// Build the middleware lazily so values loaded from .env are applied at request time.
export const createDetectionImageUpload = () => multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: getMaxImageBytes(),
  },
  fileFilter: (req, file, callback) => {
    const mimeType = normalizedMimeType(file.mimetype);
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      const error = new Error('Unsupported image type. Use JPEG, PNG, or WebP.');
      error.statusCode = 415;
      error.code = 'UNSUPPORTED_IMAGE_TYPE';
      return callback(error);
    }
    callback(null, true);
  },
});

