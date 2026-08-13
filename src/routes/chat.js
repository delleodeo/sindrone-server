// FILE: server/src/routes/chat.js
import express from 'express';
import { ChatMessage } from '../models/ChatMessage.js';
import { llmAdapter } from '../services/llmAdapter.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateChatMessage, handleValidationErrors } from '../middleware/validation.js';
import { llmLimiter } from '../middleware/security.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

const router = express.Router();

// Chat completion endpoint
router.post('/',
  llmLimiter,
  validateChatMessage,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const { message, sessionId = generateSessionId(), stream = false } = req.body;
    
    logger.info('Chat request received', { 
      sessionId: sessionId.substring(0, 8) + '...', 
      messageLength: message.length,
      stream
    });

    // Get recent conversation context
    const recentMessages = await ChatMessage.getRecentContext(sessionId, 8);
    
    // Build conversation history for LLM
    const conversationHistory = recentMessages
      .reverse() // Reverse to get chronological order
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));

    // Add current user message
    conversationHistory.push({
      role: 'user',
      content: message
    });

    // Save user message to database
    const userMessage = new ChatMessage({
      sessionId,
      role: 'user',
      content: message
    });
    await userMessage.save();

    try {
      const startTime = Date.now();

      // Handle streaming response
      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const llmResponse = await llmAdapter.generateChatCompletion(
          addSystemMessage(conversationHistory),
          { stream: true, temperature: 0.7 }
        );

        let fullContent = '';
        
        // Process streaming response
        const reader = llmResponse.body.getReader();
        const decoder = new TextDecoder();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
              if (line.trim()) {
                try {
                  const data = JSON.parse(line);
                  if (data.message?.content) {
                    const content = data.message.content;
                    fullContent += content;
                    res.write(content);
                  }
                } catch (parseError) {
                  // Ignore invalid JSON lines
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        res.end();

        // Save assistant response to database
        const assistantMessage = new ChatMessage({
          sessionId,
          role: 'assistant',
          content: fullContent,
          metadata: {
            model: process.env.OLLAMA_MODEL,
            processingTime: Date.now() - startTime,
            stream: true
          }
        });
        await assistantMessage.save();

      } else {
        // Handle regular (non-streaming) response
        const llmResponse = await llmAdapter.generateChatCompletion(
          addSystemMessage(conversationHistory),
          { stream: false, temperature: 0.7, max_tokens: 600 }
        );

        const processingTime = Date.now() - startTime;

        // Save assistant response to database
        const assistantMessage = new ChatMessage({
          sessionId,
          role: 'assistant',
          content: llmResponse.content,
          metadata: {
            model: llmResponse.model,
            processingTime,
            stream: false
          }
        });
        await assistantMessage.save();

        res.json({
          success: true,
          data: {
            message: llmResponse.content,
            sessionId,
            timestamp: new Date().toISOString(),
            metadata: {
              processingTime,
              model: llmResponse.model
            }
          }
        });
      }

    } catch (error) {
      logger.error('Chat completion failed', {
        sessionId: sessionId.substring(0, 8) + '...',
        error: error.message
      });

      if (stream) {
        res.write('\n\n❌ Sorry, I encountered an error processing your request. Please try again.');
        res.end();
      } else {
        res.status(503).json({
          error: 'Chat service temporarily unavailable',
          message: 'Please try again in a few moments',
          sessionId
        });
      }
    }
  })
);

// Get chat history for a session
router.get('/history/:sessionId',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const messages = await ChatMessage.find({ sessionId })
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .select('role content createdAt');

    res.json({
      success: true,
      sessionId,
      count: messages.length,
      data: messages.reverse() // Return in chronological order
    });
  })
);

// Delete chat session
router.delete('/session/:sessionId',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    
    const result = await ChatMessage.deleteMany({ sessionId });
    
    logger.info('Chat session deleted', { sessionId, messagesDeleted: result.deletedCount });
    
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} messages from session`,
      sessionId
    });
  })
);

// Helper function to generate session ID
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// Helper function to add system message with DalandanCare context
function addSystemMessage(messages) {
  const systemMessage = {
    role: 'system',
    content: `You are DalandanCare Assistant, a safety-focused agriculture guidance chatbot for dalandan/citrus leaf issues.

NON-NEGOTIABLE RULES (YOU MUST FOLLOW):
1) NEVER reveal or request secrets (API keys, tokens, passwords). If the user asks, refuse and explain it's unsafe.
2) Do NOT claim a certain diagnosis from a single image or minimal info. Use "likely/possible" and ask 1–3 clarifying questions when needed.
3) Do NOT invent facts, research, or citations. If unsure, say you are unsure and request more details.
4) Do NOT provide hazardous instructions, including:
   - Chemical mixing ratios, exact dosages, brand-specific pesticide directions, or combinations
   - Instructions that could harm people/animals/environment
   If asked, provide safe alternatives (IPM, sanitation) and advise consulting a licensed agriculture professional for chemical specifics.
5) ALWAYS end your response with this disclaimer (exactly one sentence):
   "Guidance only — confirm with a local agriculture technician/DA office for accurate diagnosis and treatment."

STYLE REQUIREMENTS:
- Practical, short, step-by-step bullets
- Simple English. If the user asks for Tagalog, switch to Tagalog
- Focus on: what to do today, what to monitor, prevention, and when to escalate

AREAS OF EXPERTISE:
- Dalandan (Philippine citrus) diseases: Citrus Black Spot, Citrus Canker, Citrus Greening (HLB), Healthy leaf identification
- Prevention and organic treatments
- Integrated Pest Management (IPM) approaches
- When to consult professionals
- Basic citrus farming practices in Philippine context

Remember: You help real Filipino farmers. Be accurate, safe, and responsible.`
  };

  return [systemMessage, ...messages];
}

export default router;