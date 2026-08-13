// FILE: server/src/routes/recommendations.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Recommendation } from '../models/Recommendation.js';
import { UploadHistory } from '../models/UploadHistory.js';
import { llmAdapter } from '../services/llmAdapter.js';
import { seedDatabase } from '../services/seedData.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { 
  validateDiseaseKey, 
  validateLLMRecommendation,
  validateRecommendationSeed,
  handleValidationErrors 
} from '../middleware/validation.js';
import { llmLimiter } from '../middleware/security.js';
import { logger } from '../utils/logger.js';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

const router = express.Router();

// Upload image for disease detection
router.post('/upload', upload.single('image'), asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided'
      });
    }

    const uploadRecord = new UploadHistory({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date()
    });

    await uploadRecord.save();

    res.json({
      success: true,
      data: {
        id: uploadRecord._id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        url: `/uploads/${req.file.filename}`,
        uploadedAt: uploadRecord.uploadedAt
      }
    });

  } catch (error) {
    logger.error('Error uploading image:', error);
    throw error;
  }
}));

// Get upload history
router.get('/uploads', asyncHandler(async (req, res) => {
  try {
    const uploads = await UploadHistory.find()
      .sort({ uploadedAt: -1 })
      .limit(50)
      .select('filename originalName uploadedAt diseaseDetected prediction confidence');

    res.json({
      success: true,
      data: uploads
    });
  } catch (error) {
    logger.error('Error fetching upload history:', error);
    throw error;
  }
}));

// Update upload with disease detection results
router.patch('/uploads/:id', asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { diseaseDetected, prediction, confidence } = req.body;

    const upload = await UploadHistory.findByIdAndUpdate(
      id,
      {
        diseaseDetected,
        prediction,
        confidence,
        detectionAt: new Date()
      },
      { new: true }
    );

    if (!upload) {
      return res.status(404).json({
        error: 'Upload record not found'
      });
    }

    res.json({
      success: true,
      data: upload
    });
  } catch (error) {
    logger.error('Error updating upload record:', error);
    throw error;
  }
}));

// Get recommendation by disease key
router.get('/:diseaseKey', 
  validateDiseaseKey,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { diseaseKey } = req.params;
    
    // Normalize disease key
    const normalizedKey = Recommendation.normalizeKey(diseaseKey);
    
    logger.info('Fetching recommendation', { diseaseKey: normalizedKey });
    
    const recommendation = await Recommendation.findOne({ diseaseKey: normalizedKey });
    
    if (!recommendation) {
      return res.status(404).json({
        error: 'Recommendation not found',
        diseaseKey: normalizedKey,
        availableKeys: await Recommendation.distinct('diseaseKey')
      });
    }

    // Return recommendation with safety disclaimer
    const safeRecommendation = recommendation.getSafeRecommendation();
    
    res.json({
      success: true,
      data: safeRecommendation,
      source: 'database'
    });
  })
);

// Generate AI-enhanced recommendation
router.post('/generate',
  llmLimiter,
  validateLLMRecommendation,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { diseaseKey, context = {}, enhanceExisting = true } = req.body;
    
    const normalizedKey = Recommendation.normalizeKey(diseaseKey);
    logger.info('Generating AI recommendation', { 
      diseaseKey: normalizedKey, 
      context,
      enhanceExisting 
    });

    let baseRecommendation = null;
    let source = 'ai-generated';

    // Try to get existing recommendation first if enhanceExisting is true
    if (enhanceExisting) {
      baseRecommendation = await Recommendation.findOne({ diseaseKey: normalizedKey });
      if (baseRecommendation) {
        source = 'ai-enhanced';
        // Add base recommendation info to context for LLM
        context.existingRecommendation = {
          summary: baseRecommendation.summary,
          severity: baseRecommendation.severity
        };
      }
    }

    try {
      // Generate AI recommendation
      const aiRecommendation = await llmAdapter.generateRecommendation(normalizedKey, context);
      
      // If we have a base recommendation, merge with AI enhancements
      if (baseRecommendation && enhanceExisting) {
        const enhanced = {
          ...baseRecommendation.getSafeRecommendation(),
          aiEnhancements: {
            additionalNotes: aiRecommendation.additionalNotes,
            contextualAdvice: aiRecommendation.summary,
            enhancedTreatment: aiRecommendation.treatmentSteps.filter(step => 
              !baseRecommendation.treatmentSteps.includes(step)
            ),
            enhancedPrevention: aiRecommendation.preventionSteps.filter(step =>
              !baseRecommendation.preventionSteps.includes(step)
            )
          }
        };

        return res.json({
          success: true,
          data: enhanced,
          source: 'ai-enhanced',
          context: context
        });
      }

      // Return pure AI recommendation
      res.json({
        success: true,
        data: aiRecommendation,
        source: 'ai-generated',
        context: context
      });

    } catch (error) {
      logger.error('AI recommendation generation failed', {
        diseaseKey: normalizedKey,
        error: error.message
      });

      // Fallback to database recommendation if available
      if (baseRecommendation) {
        return res.json({
          success: true,
          data: baseRecommendation.getSafeRecommendation(),
          source: 'database-fallback',
          warning: 'AI enhancement unavailable, returning base recommendation'
        });
      }

      // Complete fallback response
      res.status(503).json({
        error: 'Unable to generate recommendation at this time',
        message: 'Please try again later or contact support',
        diseaseKey: normalizedKey
      });
    }
  })
);

// Seed recommendations endpoint (development only)
router.post('/seed',
  asyncHandler(async (req, res) => {
    // Check if seeding is enabled
    if (!process.env.ENABLE_SEED_ENDPOINT || process.env.ENABLE_SEED_ENDPOINT !== 'true') {
      return res.status(404).json({ 
        error: 'Seeding endpoint is disabled' 
      });
    }

    // Additional check for development environment
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        error: 'Seeding not allowed in production environment'
      });
    }

    logger.info('Manual database seeding initiated');

    try {
      const result = await seedDatabase();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: 'Seeding failed',
        message: error.message
      });
    }
  })
);

// Custom seed data endpoint (development only)
router.post('/seed/custom',
  validateRecommendationSeed,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    if (!process.env.ENABLE_SEED_ENDPOINT || process.env.NODE_ENV === 'production') {
      return res.status(403).json({ 
        error: 'Custom seeding not allowed' 
      });
    }

    const { recommendations, clearExisting = false } = req.body;

    try {
      if (clearExisting) {
        await Recommendation.deleteMany({});
        logger.info('Cleared existing recommendations for custom seed');
      }

      const inserted = await Recommendation.insertMany(recommendations);
      
      res.json({
        success: true,
        message: `Successfully seeded ${inserted.length} custom recommendations`,
        data: inserted.map(rec => ({
          diseaseKey: rec.diseaseKey,
          displayName: rec.displayName,
          severity: rec.severity
        }))
      });

    } catch (error) {
      logger.error('Custom seeding failed', { error: error.message });
      res.status(500).json({
        error: 'Custom seeding failed',
        message: error.message
      });
    }
  })
);

// List all available disease keys
router.get('/',
  asyncHandler(async (req, res) => {
    const recommendations = await Recommendation.find({}, 'diseaseKey displayName severity updatedAt')
      .sort({ diseaseKey: 1 });

    res.json({
      success: true,
      count: recommendations.length,
      data: recommendations
    });
  })
);

export default router;