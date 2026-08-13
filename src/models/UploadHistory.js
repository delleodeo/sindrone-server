// FILE: server/src/models/UploadHistory.js
import mongoose from 'mongoose';

const uploadHistorySchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true,
    unique: true
  },
  originalName: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  diseaseDetected: {
    type: String,
    default: null
  },
  prediction: {
    type: String,
    default: null
  },
  confidence: {
    type: Number,
    default: null
  },
  detectionAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Create indexes for better query performance
uploadHistorySchema.index({ uploadedAt: -1 });
uploadHistorySchema.index({ filename: 1 });
uploadHistorySchema.index({ diseaseDetected: 1 });

export const UploadHistory = mongoose.model('UploadHistory', uploadHistorySchema);