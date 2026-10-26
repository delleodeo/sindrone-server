import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  detectWithRoboflow,
  normalizeRoboflowResponse,
  RoboflowServiceError,
} from '../src/services/roboflowService.js';
import { detectImageMimeType, validateUploadedImage } from '../src/middleware/imageUpload.js';
import { CLASS_CATALOG, CLASS_CATEGORIES } from '../../shared/classCatalog.js';

const validPayload = {
  image: { width: 1200, height: 800 },
  predictions: [
    { class: 'citrus_psyllid', confidence: 0.94, x: 300, y: 250, width: 180, height: 120 },
    { class: 'citrus_canker', confidence: 0.88, x: 700, y: 400, width: 220, height: 160 },
  ],
};

test('maps supported classes and preserves multiple bounding boxes', () => {
  const result = normalizeRoboflowResponse(validPayload, 0.75);
  assert.equal(result.status, 'detected');
  assert.deepEqual(result.image, { width: 1200, height: 800 });
  assert.equal(result.predictions.length, 2);
  assert.deepEqual(result.predictions[0], {
    className: 'citrus_psyllid',
    displayLabel: 'Citrus Psyllid',
    category: 'pest',
    confidence: 0.94,
    boundingBox: { x: 210, y: 190, width: 180, height: 120 },
  });
});

test('preserves unknown labels safely and filters low-confidence predictions', () => {
  const result = normalizeRoboflowResponse({
    image: { width: 640, height: 480 },
    predictions: [
      { class: 'unlisted_provider_label', confidence: 0.99, x: 1, y: 1, width: 1, height: 1 },
      { class: 'other_scale_insect', confidence: 0.70, x: 2, y: 2, width: 1, height: 1 },
      { class: 'red_wax_scale', confidence: 0.90, x: 3, y: 3, width: 1, height: 1 },
    ],
  }, 0.75);

  assert.equal(result.predictions.length, 2);
  assert.equal(result.predictions[0].displayLabel, 'unlisted_provider_label');
  assert.equal(result.predictions[0].category, CLASS_CATEGORIES.unknown);
  assert.equal(result.predictions[1].displayLabel, 'Red Wax Scale');
});

test('catalog contains exactly 40 unique labels with required category counts', () => {
  assert.equal(CLASS_CATALOG.length, 40);
  assert.equal(new Set(CLASS_CATALOG.map((item) => item.label)).size, 40);
  assert.equal(CLASS_CATALOG.filter((item) => item.category === 'disease').length, 15);
  assert.equal(CLASS_CATALOG.filter((item) => item.category === 'pest').length, 18);
  assert.equal(CLASS_CATALOG.filter((item) => item.category === 'other').length, 7);
  assert.equal(CLASS_CATALOG.some((item) => item.label === 'citrus_mealybug'), false);
});

test('accepts every supported class when the configured threshold is zero', () => {
  const result = normalizeRoboflowResponse({
    image: { width: 640, height: 480 },
    predictions: [
      { class: 'citrus_black_spot', confidence: 0.01, x: 10, y: 10, width: 20, height: 20 },
      { class: 'citrus_psyllid', confidence: 0, x: 30, y: 30, width: 20, height: 20 },
    ],
  }, 0);

  assert.equal(result.status, 'detected');
  assert.equal(result.predictions.length, 2);
  assert.deepEqual(result.predictions.map((item) => item.className), [
    'citrus_black_spot',
    'citrus_psyllid',
  ]);
});

test('returns no_supported_detection for an empty prediction array', () => {
  const result = normalizeRoboflowResponse({
    image: { width: 640, height: 480 },
    predictions: [],
  }, 0.75);
  assert.equal(result.status, 'no_supported_detection');
  assert.deepEqual(result.predictions, []);
});

test('rejects malformed upstream responses', () => {
  assert.throws(
    () => normalizeRoboflowResponse({ predictions: [] }, 0.75),
    (error) => error instanceof RoboflowServiceError && error.code === 'ROBOFLOW_MALFORMED_RESPONSE',
  );
});

test('validates JPEG, PNG, and WebP signatures and rejects spoofed uploads', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');
  assert.equal(detectImageMimeType(jpeg), 'image/jpeg');
  assert.equal(detectImageMimeType(png), 'image/png');
  assert.equal(detectImageMimeType(webp), 'image/webp');
  assert.throws(
    () => validateUploadedImage({ mimetype: 'image/png', buffer: Buffer.from('not an image') }),
    (error) => error.statusCode === 415,
  );
});

test('maps authentication failure without exposing the API key', async () => {
  const secret = 'private-test-key';
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
  });

  await assert.rejects(
    detectWithRoboflow(Buffer.from('image'), { apiKey: secret, fetchImpl }),
    (error) => error.code === 'ROBOFLOW_AUTHENTICATION_FAILED' && !error.message.includes(secret),
  );
});

test('sends base64 image data to Roboflow with a server-only bearer key', async () => {
  const secret = 'private-test-key';
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => validPayload,
    };
  };

  const result = await detectWithRoboflow(Buffer.from('image'), {
    apiKey: secret,
    endpoint: 'https://example.test/roboflow',
    fetchImpl,
  });

  assert.equal(result.status, 'detected');
  assert.equal(request.url, 'https://example.test/roboflow');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(request.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(request.options.body, Buffer.from('image').toString('base64'));
  assert.ok(request.options.signal);
});

test('maps upstream rate limiting separately', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => '30' },
  });
  await assert.rejects(
    detectWithRoboflow(Buffer.from('image'), { apiKey: 'test', fetchImpl }),
    (error) => error.code === 'ROBOFLOW_RATE_LIMITED' && error.retryAfter === '30',
  );
});

test('maps upstream timeout separately', async () => {
  const fetchImpl = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  await assert.rejects(
    detectWithRoboflow(Buffer.from('image'), { apiKey: 'test', fetchImpl, timeoutMs: 5 }),
    (error) => error.code === 'ROBOFLOW_TIMEOUT' && error.statusCode === 504,
  );
});

test('frontend source does not reference the private key variable', async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const apiSource = await readFile(path.resolve(testDirectory, '../../client/src/utils/api.js'), 'utf8');
  const detectSource = await readFile(path.resolve(testDirectory, '../../client/src/views/Detect.vue'), 'utf8');
  assert.equal(apiSource.includes('ROBOFLOW_API_KEY'), false);
  assert.equal(detectSource.includes('ROBOFLOW_API_KEY'), false);
});
