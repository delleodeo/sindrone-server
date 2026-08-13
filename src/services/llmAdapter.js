// FILE: server/src/services/llmAdapter.js
import { logger } from '../utils/logger.js';
import { configDotenv } from 'dotenv';

configDotenv();
class LLMAdapter {
  constructor() {
    // Groq API configuration
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.groqBaseUrl = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
    this.defaultModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT) || 30000;
    
    // Debug logging (remove in production)
    if (!this.groqApiKey) {
      logger.error('GROQ_API_KEY is not set in environment variables');
    } else {
      logger.info('Groq API configured', { 
        keyPrefix: this.groqApiKey.substring(0, 10) + '...', 
        baseUrl: this.groqBaseUrl,
        model: this.defaultModel 
      });
    }
    
    // Safety patterns to detect
    this.unsafePatterns = [
      /api.?key/i, /secret/i, /password/i, /token/i, /credential/i,
      /mixing.*chemical/i, /chemical.*mix/i, /exact.*dosage/i,
      /pesticide.*combination/i, /combine.*pesticide/i
    ];
  }

  // Test LLM connection
  async isHealthy() {
    try {
      // Simple test request to Groq API
      const response = await fetch(`${this.groqBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        }),
        signal: AbortSignal.timeout(10000)
      });
      return response.ok;
    } catch (error) {
      logger.error('LLM health check failed', { error: error.message });
      return false;
    }
  }

  // Check for unsafe content requests
  isUnsafeRequest(message) {
    for (const pattern of this.unsafePatterns) {
      if (pattern.test(message)) {
        return true;
      }
    }
    return false;
  }

  // Get the DalandanCare system prompt with safety rules
  getDalandanCareSystemPrompt() {
    return `You are DalandanCare Assistant, a safety-focused agriculture guidance chatbot for dalandan/citrus leaf issues.

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

Remember: You help real Filipino farmers. Be accurate, safe, and responsible.`;
  }

  // Generate chat completion using Groq API
  async generateChatCompletion(messages, options = {}) {
    try {
      // Validate API key
      if (!this.groqApiKey) {
        throw new Error('Groq API key is not configured. Check GROQ_API_KEY environment variable.');
      }

      // Check for unsafe content in the last user message
      const lastUserMessage = messages.find(m => m.role === 'user');
      if (lastUserMessage && this.isUnsafeRequest(lastUserMessage.content)) {
        return {
          content: "I cannot provide that information as it may be unsafe. I don't share or request API keys, passwords, or secrets. For chemical-specific questions (exact dosages, mixing ratios), please consult a licensed agriculture professional or your local DA office.\n\nGuidance only — confirm with a local agriculture technician/DA office for accurate diagnosis and treatment.",
          model: this.defaultModel,
          created: new Date().toISOString(),
          done: true
        };
      }

      const payload = {
        model: options.model || this.defaultModel,
        messages: this.formatMessages(messages),
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 600,
        top_p: options.top_p || 0.9,
        stream: false
      };

      logger.info('Sending request to Groq API', { 
        model: payload.model,
        messageCount: messages.length,
        apiKeyPresent: !!this.groqApiKey
      });

      const response = await fetch(`${this.groqBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey.trim()}`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorData = await response.text();
        logger.error('Groq API error response', { 
          status: response.status, 
          error: errorData,
          apiKeyPrefix: this.groqApiKey ? this.groqApiKey.substring(0, 10) + '...' : 'NOT_SET'
        });
        throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      let content = result.choices?.[0]?.message?.content || '';
      
      // Ensure disclaimer is present
      const disclaimer = "Guidance only — confirm with a local agriculture technician/DA office for accurate diagnosis and treatment.";
      if (!content.includes(disclaimer) && !content.includes("Guidance only")) {
        content = content.trim() + "\n\n" + disclaimer;
      }

      return {
        content,
        model: result.model,
        created: result.created,
        done: true,
        usage: result.usage
      };

    } catch (error) {
      logger.error('Groq LLM generation failed', { error: error.message });
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  // Format messages for Groq API (OpenAI-compatible format)
  formatMessages(messages) {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  // Generate structured recommendation using LLM
  async generateRecommendation(diseaseKey, context = {}) {
    const prompt = this.buildRecommendationPrompt(diseaseKey, context);
    
    try {
      const messages = [
        {
          role: 'system',
          content: this.getRecommendationSystemPrompt()
        },
        {
          role: 'user',
          content: prompt
        }
      ];

      const result = await this.generateChatCompletion(messages, {
        temperature: 0.3,
        max_tokens: 800
      });

      return this.parseRecommendationResponse(result.content);

    } catch (error) {
      logger.error('Failed to generate recommendation', { 
        diseaseKey, 
        error: error.message 
      });
      throw error;
    }
  }

  // Build recommendation prompt
  buildRecommendationPrompt(diseaseKey, context) {
    const diseaseNames = {
      'healthy': 'Healthy Citrus',
      'black-spot': 'Citrus Black Spot',
      'canker': 'Citrus Canker',
      'greening': 'Citrus Greening (HLB)'
    };

    const diseaseName = diseaseNames[diseaseKey] || diseaseKey;

    return `
Generate agricultural guidance for ${diseaseName} in dalandan/citrus crops.
${context.severity ? `Detected severity: ${context.severity}` : ''}
${context.confidence ? `Model confidence: ${context.confidence}%` : ''}
${context.userContext ? `Additional context: ${context.userContext}` : ''}

Provide a JSON response with this structure:
{
  "summary": "Brief 1-2 sentence overview using 'likely' or 'possible'",
  "symptoms": ["symptom1", "symptom2", "symptom3"],
  "causes": ["cause1", "cause2"],
  "treatmentSteps": ["safe step1", "safe step2", "safe step3"],
  "preventionSteps": ["prevention1", "prevention2", "prevention3"],
  "whenToEscalate": ["escalation1", "escalation2"],
  "additionalNotes": "Farmer-specific advice"
}

RULES:
- Use "likely" or "possible" - never claim certainty
- NO exact chemical dosages or mixing ratios
- Focus on IPM and sanitation first
- Recommend consulting DA office for chemical specifics
`;
  }

  // System prompt for recommendation generation
  getRecommendationSystemPrompt() {
    return `You are DalandanCare Assistant generating structured disease recommendations.

SAFETY RULES:
- Never provide exact chemical dosages or mixing ratios
- Always use "likely/possible" for diagnosis
- Recommend consulting professionals for chemical specifics
- Prioritize IPM and sanitation approaches
- Include organic options when available

Respond ONLY with valid JSON format as requested.`;
  }

  // Parse and validate recommendation response
  parseRecommendationResponse(content) {
    try {
      const cleanContent = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      // Try to extract JSON from the content
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const required = ['summary', 'symptoms', 'causes', 'treatmentSteps', 'preventionSteps'];
      const missing = required.filter(field => !parsed[field] || (Array.isArray(parsed[field]) && parsed[field].length === 0));
      
      if (missing.length > 0) {
        throw new Error(`Missing required fields: ${missing.join(', ')}`);
      }

      parsed.disclaimer = "Guidance only — confirm with a local agriculture technician/DA office for accurate diagnosis and treatment.";

      return parsed;

    } catch (error) {
      logger.error('Failed to parse LLM recommendation response', { 
        content: content.substring(0, 200),
        error: error.message 
      });
      
      return {
        summary: "Based on the analysis, this may indicate a citrus health issue that requires further assessment.",
        symptoms: ["Observe leaf discoloration, spots, or unusual growth patterns", "Check for lesions or abnormal textures", "Note any yellowing or wilting"],
        causes: ["Various environmental factors", "Possible pathogenic infection"],
        treatmentSteps: [
          "Remove and dispose of severely affected leaves properly",
          "Improve air circulation around the plant",
          "Ensure proper watering (not too wet/dry)",
          "Consult local DA office for specific treatment recommendations"
        ],
        preventionSteps: [
          "Maintain proper plant spacing",
          "Regular monitoring and inspection",
          "Practice good sanitation (clean tools, remove debris)"
        ],
        whenToEscalate: [
          "If symptoms spread rapidly to other plants",
          "If conventional treatments show no improvement after 2 weeks"
        ],
        disclaimer: "Guidance only — confirm with a local agriculture technician/DA office for accurate diagnosis and treatment."
      };
    }
  }
}

export const llmAdapter = new LLMAdapter();