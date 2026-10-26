import { logger } from '../utils/logger.js';
import {
  CLASS_CATALOG_BY_LABEL,
  CLASS_CATEGORIES,
} from '../../../shared/classCatalog.js';

const DEFAULT_MODEL_ID = 'citrus-disease-detection-yoydc-ygw6l/1';
const DEFAULT_ENDPOINT = `https://serverless.roboflow.com/${DEFAULT_MODEL_ID}`;
const DEFAULT_THRESHOLD = 0;
const DEFAULT_TIMEOUT_MS = 20_000;

export class RoboflowServiceError extends Error {
  constructor(message, { statusCode = 502, code = 'ROBOFLOW_ERROR', retryAfter } = {}) {
    super(message);
    this.name = 'RoboflowServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const asPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getConfidenceThreshold = (value = process.env.ROBOFLOW_CONFIDENCE_THRESHOLD) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_THRESHOLD;
};

const getModelId = () => process.env.ROBOFLOW_MODEL_ID || DEFAULT_MODEL_ID;

const getEndpoint = () => process.env.ROBOFLOW_API_URL || `https://serverless.roboflow.com/${getModelId()}`;

const classifyLabel = (label) => CLASS_CATALOG_BY_LABEL[label]?.category || CLASS_CATEGORIES.unknown;

const normalizeBox = (prediction, imageWidth, imageHeight) => {
  const x = Number(prediction?.x);
  const y = Number(prediction?.y);
  const width = Number(prediction?.width);
  const height = Number(prediction?.height);

  if (
    !Number.isFinite(x) || !Number.isFinite(y) ||
    !Number.isFinite(width) || width < 0 ||
    !Number.isFinite(height) || height < 0
  ) {
    throw new RoboflowServiceError('Detection service returned an invalid bounding box', {
      code: 'ROBOFLOW_MALFORMED_RESPONSE',
    });
  }

  return {
    x: Math.max(0, x - width / 2),
    y: Math.max(0, y - height / 2),
    width: Math.min(width, imageWidth),
    height: Math.min(height, imageHeight),
  };
};

export const normalizeRoboflowResponse = (
  payload,
  threshold = DEFAULT_THRESHOLD,
  modelId = getModelId(),
) => {
  const imageWidth = asPositiveNumber(payload?.image?.width);
  const imageHeight = asPositiveNumber(payload?.image?.height);

  if (
    !payload || typeof payload !== 'object' ||
    !imageWidth || !imageHeight || !Array.isArray(payload.predictions)
  ) {
    throw new RoboflowServiceError('Detection service returned an invalid response', {
      code: 'ROBOFLOW_MALFORMED_RESPONSE',
    });
  }

  const normalizedThreshold = getConfidenceThreshold(threshold);
  const predictions = payload.predictions.map((prediction) => {
    const className = prediction?.class;
    const confidence = Number(prediction?.confidence);

    if (
      typeof className !== 'string' ||
      !Number.isFinite(confidence) || confidence < 0 || confidence > 1
    ) {
      throw new RoboflowServiceError('Detection service returned an invalid prediction', {
        code: 'ROBOFLOW_MALFORMED_RESPONSE',
      });
    }

    if (confidence < normalizedThreshold) return null;

    const catalogEntry = CLASS_CATALOG_BY_LABEL[className];
    return {
      className,
      displayLabel: catalogEntry?.displayName || className,
      category: catalogEntry?.category || CLASS_CATEGORIES.unknown,
      confidence,
      boundingBox: normalizeBox(prediction, imageWidth, imageHeight),
    };
  }).filter(Boolean);

  predictions.sort((left, right) => right.confidence - left.confidence);

  return {
    status: predictions.length ? 'detected' : 'no_supported_detection',
    image: { width: imageWidth, height: imageHeight },
    predictions,
    threshold: normalizedThreshold,
    modelId,
  };
};

const upstreamError = (response) => {
  if (response.status === 401 || response.status === 403) {
    return new RoboflowServiceError('Detection service authentication failed', {
      statusCode: 502,
      code: 'ROBOFLOW_AUTHENTICATION_FAILED',
    });
  }

  if (response.status === 429) {
    return new RoboflowServiceError('Detection service rate limit reached. Please try again later.', {
      statusCode: 503,
      code: 'ROBOFLOW_RATE_LIMITED',
      retryAfter: response.headers?.get?.('retry-after') || undefined,
    });
  }

  return new RoboflowServiceError('Detection service is temporarily unavailable', {
    code: 'ROBOFLOW_UPSTREAM_ERROR',
  });
};

export const detectWithRoboflow = async (
  imageBuffer,
  {
    apiKey = process.env.ROBOFLOW_API_KEY,
    endpoint = getEndpoint(),
    modelId = getModelId(),
    threshold = getConfidenceThreshold(),
    timeoutMs = Number(process.env.ROBOFLOW_REQUEST_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {},
) => {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new RoboflowServiceError('A valid image is required', {
      statusCode: 400,
      code: 'INVALID_IMAGE',
    });
  }

  if (!apiKey) {
    throw new RoboflowServiceError(
      'Detection service is not configured. Set ROBOFLOW_API_KEY in server/.env and restart the server.',
      { statusCode: 503, code: 'ROBOFLOW_NOT_CONFIGURED' },
    );
  }

  const timeoutSignal = AbortSignal.timeout(asPositiveNumber(timeoutMs) || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: imageBuffer.toString('base64'),
      signal: timeoutSignal,
    });

    if (!response.ok) throw upstreamError(response);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new RoboflowServiceError('Detection service returned malformed JSON', {
        code: 'ROBOFLOW_MALFORMED_RESPONSE',
      });
    }

    const result = normalizeRoboflowResponse(payload, threshold, modelId);
    logger.info('Roboflow detection completed', {
      modelId,
      rawPredictionCount: payload.predictions.length,
      acceptedPredictionCount: result.predictions.length,
      threshold: result.threshold,
      status: result.status,
    });
    return result;
  } catch (error) {
    if (error instanceof RoboflowServiceError) throw error;
    if (timeoutSignal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new RoboflowServiceError('Detection service timed out', {
        statusCode: 504,
        code: 'ROBOFLOW_TIMEOUT',
      });
    }
    throw new RoboflowServiceError('Unable to reach the detection service', {
      code: 'ROBOFLOW_NETWORK_ERROR',
    });
  }
};
