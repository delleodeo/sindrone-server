// FILE: server/src/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import dotenv from "dotenv";
import path from "path";
import connectDB from "./config/database.js";
import { logger } from "./utils/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import {
  securityMiddleware,
  apiLimiter,
  sanitizeInput,
} from "./middleware/security.js";

// Import routes
import healthRoutes from "./routes/health.js";
import recommendationRoutes from "./routes/recommendations.js";
import chatRoutes from "./routes/chat.js";

// Load environment variables
dotenv.config();

// Log environment status (remove in production)
logger.info('Environment variables loaded', {
  port: process.env.PORT,
  mongoUri: process.env.MONGODB_URI ? 'SET' : 'NOT_SET',
  groqApiKey: process.env.GROQ_API_KEY ? 'SET' : 'NOT_SET',
  groqModel: process.env.GROQ_MODEL,
  corsOrigins: process.env.CORS_ORIGINS
});

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for rate limiting behind reverse proxy
app.set("trust proxy", 1);

// Security middleware
app.use(securityMiddleware);

// CORS configuration
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Request parsing and compression
app.use(compression());
app.use(
  express.json({
    limit: process.env.MAX_JSON_SIZE || "10mb",
    strict: true,
  }),
);
app.use(
  express.urlencoded({
    extended: true,
    limit: process.env.MAX_JSON_SIZE || "10mb",
  }),
);

// Input sanitization
app.use(sanitizeInput);

// Logging middleware
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(
    morgan("combined", {
      skip: (req, res) => res.statusCode < 400,
      stream: {
        write: (message) => logger.info(message.trim()),
      },
    }),
  );
}

// Rate limiting
app.use("/api", apiLimiter);

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check endpoint (no rate limiting)
app.use("/api/health", healthRoutes);

// API routes
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/chat", chatRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "AgriDrone Citrus Disease Detection API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      health: "/api/health",
      recommendations: "/api/recommendations",
      chat: "/api/chat",
    },
    documentation: "See README.md for detailed API documentation",
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown handler
const gracefulShutdown = (server) => (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully`);

  server.close(() => {
    logger.info("Process terminated gracefully");
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(`🌐 CORS origins: ${corsOrigins.join(", ")}`);
      logger.info(
        `🤖 LLM service: ${process.env.OLLAMA_API_URL || "http://localhost:11434"}`,
      );
      logger.info(`📡 API available at: http://localhost:${PORT}/api`);
    });

    // Handle server errors
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        logger.error(`Port ${PORT} is already in use`);
      } else {
        logger.error("Server error:", { error: error.message });
      }
      process.exit(1);
    });

    // Graceful shutdown handlers
    process.on("SIGTERM", gracefulShutdown(server));
    process.on("SIGINT", gracefulShutdown(server));

    return server;
  } catch (error) {
    logger.error("Failed to start server:", { error: error.message });
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
  logger.error("Unhandled Promise Rejection:", {
    error: err.message,
    stack: err.stack,
  });
  // Don't exit in development to keep debugging session alive
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

// Start the server
startServer();
