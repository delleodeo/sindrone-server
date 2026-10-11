// FILE: server/src/routes/health.js
import express from 'express';
import { llmAdapter } from '../services/llmAdapter.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Health check endpoint
router.get('/', asyncHandler(async (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  };

  // Check database connection
  try {
    const mongoose = await import('mongoose');
    healthCheck.database = {
      status: mongoose.default.connection.readyState === 1 ? 'connected' : 'disconnected',
      host: mongoose.default.connection.host,
      name: mongoose.default.connection.name
    };
  } catch (error) {
    healthCheck.database = {
      status: 'error',
      error: error.message
    };
  }

  // Check LLM service (Groq API)
  try {
    const llmHealthy = await llmAdapter.isHealthy();
    healthCheck.llm = {
      status: llmHealthy ? 'available' : 'unavailable',
      service: 'groq',
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b'
    };
  } catch (error) {
    healthCheck.llm = {
      status: 'error',
      error: error.message
    };
  }

  // The API can still serve disease detection and stored recommendations when
  // the optional LLM provider is unavailable. Report that state as degraded
  // instead of making clients interpret the entire backend as unavailable.
  const isDatabaseHealthy = healthCheck.database.status === 'connected';
  const isLlmHealthy = healthCheck.llm.status === 'available';

  healthCheck.status = !isDatabaseHealthy
    ? 'unhealthy'
    : isLlmHealthy
      ? 'ok'
      : 'degraded';

  res.status(isDatabaseHealthy ? 200 : 503).json(healthCheck);
}));

// Detailed system information (dev only)
router.get('/system', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Endpoint not available in production' });
  }

  const systemInfo = {
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024)
    },
    environment: {
      nodeEnv: process.env.NODE_ENV,
      port: process.env.PORT,
      mongoUri: process.env.MONGODB_URI ? '***configured***' : 'not set',
      ollamaUrl: process.env.OLLAMA_API_URL
    }
  };

  res.json(systemInfo);
}));

export default router;
