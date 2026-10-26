import express from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  createDetectionImageUpload,
  getMaxImageBytes,
  validateUploadedImage,
} from '../middleware/imageUpload.js';
import { detectWithRoboflow } from '../services/roboflowService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const receiveImage = (req, res, next) => {
  createDetectionImageUpload().single('image')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      error.statusCode = 413;
      error.code = 'IMAGE_TOO_LARGE';
      error.message = `Image exceeds the ${getMaxImageBytes()} byte upload limit`;
    }
    return next(error);
  });
};

router.post('/', receiveImage, asyncHandler(async (req, res) => {
  validateUploadedImage(req.file);

  const result = await detectWithRoboflow(req.file.buffer);

  logger.info('Roboflow detection completed', {
    status: result.status,
    acceptedPredictions: result.predictions.length,
    imageWidth: result.image.width,
    imageHeight: result.image.height,
  });

  res.json(result);
}));

export default router;

