// FILE: server/src/models/ChatMessage.js
import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  role: {
    type: String,
    required: true,
    enum: ['user', 'assistant', 'system'],
    lowercase: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 4000
  },
  metadata: {
    model: String,
    confidence: Number,
    processingTime: Number,
    tokensUsed: Number
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false // We're managing createdAt manually
});

// Compound index for efficient session queries
chatMessageSchema.index({ sessionId: 1, createdAt: 1 });

// Static method to get recent conversation context
chatMessageSchema.statics.getRecentContext = async function(sessionId, limit = 10) {
  return this.find({ sessionId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('role content createdAt')
    .lean();
};

// Static method to cleanup old messages (data retention)
chatMessageSchema.statics.cleanupOldMessages = async function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const result = await this.deleteMany({
    createdAt: { $lt: cutoffDate }
  });
  
  return result.deletedCount;
};

// Instance method to sanitize for API response
chatMessageSchema.methods.toSafeObject = function() {
  const obj = this.toObject();
  // Remove sensitive metadata for user-facing responses
  if (obj.metadata) {
    delete obj.metadata.tokensUsed;
  }
  return obj;
};

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);