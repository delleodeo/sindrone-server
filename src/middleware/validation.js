// FILE: server/src/middleware/validation.js
import { body, param, validationResult } from 'express-validator';

// Validation error handler
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

// Common validation rules
export const validateDiseaseKey = [
  param('diseaseKey')
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Disease key must be lowercase alphanumeric with hyphens only')
];

export const validateChatMessage = [
  body('message')
    .isString()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be 1-1000 characters'),
  body('sessionId')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .matches(/^[a-zA-Z0-9-_]+$/)
    .withMessage('Session ID must be alphanumeric with hyphens and underscores only')
];

export const validateLLMRecommendation = [
  body('diseaseKey')
    .isString()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Disease key must be lowercase alphanumeric with hyphens only'),
  body('context')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Context must be maximum 500 characters'),
  body('severity')
    .optional()
    .isIn(['low', 'medium', 'high'])
    .withMessage('Severity must be low, medium, or high')
];

export const validateRecommendationSeed = [
  body('recommendations')
    .isArray({ min: 1 })
    .withMessage('Recommendations must be a non-empty array'),
  body('recommendations.*.diseaseKey')
    .isString()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Each disease key must be lowercase alphanumeric with hyphens only'),
  body('recommendations.*.displayName')
    .isString()
    .isLength({ min: 2, max: 100 })
    .withMessage('Display name must be 2-100 characters'),
  body('recommendations.*.summary')
    .isString()
    .isLength({ min: 10, max: 500 })
    .withMessage('Summary must be 10-500 characters'),
  body('recommendations.*.severity')
    .isIn(['low', 'medium', 'high'])
    .withMessage('Severity must be low, medium, or high'),
  body('recommendations.*.symptoms')
    .isArray({ min: 1 })
    .withMessage('Symptoms must be a non-empty array'),
  body('recommendations.*.treatmentSteps')
    .isArray({ min: 1 })
    .withMessage('Treatment steps must be a non-empty array'),
  body('recommendations.*.preventionSteps')
    .isArray({ min: 1 })
    .withMessage('Prevention steps must be a non-empty array')
];