// FILE: server/src/models/Recommendation.js
import mongoose from 'mongoose';

const recommendationSchema = new mongoose.Schema({
  diseaseKey: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  displayName: {
    type: String,
    required: true,
    trim: true
  },
  summary: {
    type: String,
    required: true,
    maxlength: 500
  },
  symptoms: [{
    type: String,
    required: true,
    trim: true
  }],
  causes: [{
    type: String,
    required: true,
    trim: true
  }],
  treatmentSteps: [{
    type: String,
    required: true,
    trim: true
  }],
  preventionSteps: [{
    type: String,
    required: true,
    trim: true
  }],
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high'],
    lowercase: true
  },
  whenToEscalate: [{
    type: String,
    required: true,
    trim: true
  }],
  references: [{
    type: String,
    trim: true
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Add text index for search functionality
recommendationSchema.index({
  displayName: 'text',
  summary: 'text',
  symptoms: 'text',
  causes: 'text'
});

// Pre-save hook to ensure diseaseKey consistency
recommendationSchema.pre('save', function(next) {
  if (this.diseaseKey) {
    this.diseaseKey = this.diseaseKey.toLowerCase().replace(/\s+/g, '-');
  }
  next();
});

// Instance method to get summary with confidence disclaimer
recommendationSchema.methods.getSafeRecommendation = function() {
  return {
    ...this.toObject(),
    disclaimer: "This is guidance only. Always consult an agriculture expert for professional diagnosis and treatment confirmation."
  };
};

// Static method to normalize disease keys
recommendationSchema.statics.normalizeKey = function(key) {
  return key.toLowerCase().trim().replace(/\s+/g, '-');
};

export const Recommendation = mongoose.model('Recommendation', recommendationSchema);