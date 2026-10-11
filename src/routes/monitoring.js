import express from 'express';
import { body, query, validationResult } from 'express-validator';
import monitoringService from '../services/monitoringService.js';

const router = express.Router();

const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

const sum = (values) => values.filter(Number.isFinite).reduce((total, value) => total + value, 0);

const locationCache = new Map();
let reverseGeocodeQueue = Promise.resolve();
let lastReverseGeocodeAt = 0;

const reverseGeocode = (latitude, longitude) => {
  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  const cached = locationCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 24 * 60 * 60 * 1000) return Promise.resolve(cached.value);

  const lookup = async () => {
    // The public Nominatim service requires a maximum of one request per second.
    const waitMs = Math.max(0, 1100 - (Date.now() - lastReverseGeocodeAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastReverseGeocodeAt = Date.now();

    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(latitude),
      lon: String(longitude),
      zoom: '10',
      addressdetails: '1',
      layer: 'address',
      'accept-language': 'en',
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': 'AgriDrone/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Location provider returned ${response.status}`);

    const data = await response.json();
    const address = data.address || {};
    const locality = address.city || address.town || address.municipality || address.village || address.county || address.state_district;
    const province = address.province || address.state || address.region;
    const parts = [locality, province, address.country]
      .filter(Boolean)
      .filter((part, index, values) => values.findIndex((item) => item.toLowerCase() === part.toLowerCase()) === index);
    const value = {
      name: locality || province || address.country || 'Selected field location',
      province: province || null,
      country: address.country || null,
      label: parts.join(', ') || data.display_name || 'Selected field location',
      attribution: 'OpenStreetMap contributors',
    };

    if (locationCache.size >= 200) locationCache.delete(locationCache.keys().next().value);
    locationCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  };

  const task = reverseGeocodeQueue.then(lookup, lookup);
  reverseGeocodeQueue = task.catch(() => undefined);
  return task;
};

const fetchWeatherForecast = async (latitude, longitude, days) => {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
    ].join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'apparent_temperature_max',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'et0_fao_evapotranspiration',
      'sunrise',
      'sunset',
    ].join(','),
    timezone: 'auto',
    forecast_days: String(days),
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    const error = new Error(`Open-Meteo returned ${response.status}`);
    error.status = response.status;
    error.details = details;
    throw error;
  }

  return response.json();
};

// Ingest readings from either the demo simulator or a field IoT device.
router.post(
  '/soil',
  [
    body('deviceId').optional().isString().isLength({ max: 100 }),
    body('source').optional().isIn(['demo', 'iot', 'manual']),
    body('moisture').optional().isFloat({ min: 0, max: 100 }),
    body('temperature').optional().isFloat({ min: -50, max: 80 }),
    body('ph').optional().isFloat({ min: 0, max: 14 }),
    body('n').optional().isFloat({ min: 0 }),
    body('p').optional().isFloat({ min: 0 }),
    body('k').optional().isFloat({ min: 0 }),
    body('battery').optional().isFloat({ min: 0, max: 100 }),
    body('signalStrength').optional().isFloat({ min: -150, max: 0 }),
    body('timestamp').optional().isISO8601(),
  ],
  checkValidation,
  (req, res) => {
    const reading = monitoringService.addSoilReading(req.body);
    return res.status(201).json({ message: 'Soil reading saved', reading });
  },
);

router.get('/soil/latest', (req, res) => {
  const latest = monitoringService.getLatestSoil();
  if (!latest) return res.status(404).json({ error: 'No soil readings available' });
  return res.json({ latest, assessment: monitoringService.assessSoil(latest) });
});

router.get(
  '/soil/history',
  [query('limit').optional().isInt({ min: 1, max: 500 })],
  checkValidation,
  (req, res) => {
    const limit = parseInt(req.query.limit || '50', 10);
    return res.json({ history: monitoringService.getSoilHistory(limit) });
  },
);

// Public forecast proxy. Open-Meteo does not require an API key.
router.get(
  '/weather',
  [
    query('lat').exists().isFloat({ min: -90, max: 90 }),
    query('lon').exists().isFloat({ min: -180, max: 180 }),
    query('days').optional().isInt({ min: 1, max: 16 }),
  ],
  checkValidation,
  async (req, res) => {
    try {
      const latitude = Number(req.query.lat);
      const longitude = Number(req.query.lon);
      const days = parseInt(req.query.days || '5', 10);
      const data = await fetchWeatherForecast(latitude, longitude, days);

      res.set('Cache-Control', 'public, max-age=300');
      return res.json({
        provider: 'open-meteo',
        fetchedAt: new Date().toISOString(),
        location: {
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone,
          elevation: data.elevation,
        },
        data,
      });
    } catch (error) {
      return res.status(502).json({
        error: 'Weather service temporarily unavailable',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Convert field coordinates into a human-readable locality. Results are
// cached for 24 hours to respect the public OpenStreetMap service limits.
router.get(
  '/location',
  [
    query('lat').exists().isFloat({ min: -90, max: 90 }),
    query('lon').exists().isFloat({ min: -180, max: 180 }),
  ],
  checkValidation,
  async (req, res) => {
    try {
      const location = await reverseGeocode(Number(req.query.lat), Number(req.query.lon));
      res.set('Cache-Control', 'private, max-age=86400');
      return res.json({ provider: 'openstreetmap-nominatim', location });
    } catch (error) {
      return res.status(502).json({
        error: 'Location name temporarily unavailable',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

const bandFactor = (value, ideal, acceptable, floor = 0.55) => {
  if (!Number.isFinite(value)) return 0.72;
  const [idealMin, idealMax] = ideal;
  const [acceptableMin, acceptableMax] = acceptable;
  if (value >= idealMin && value <= idealMax) return 1;

  if (value < idealMin) {
    if (value <= acceptableMin) return floor;
    return floor + ((value - acceptableMin) / (idealMin - acceptableMin)) * (1 - floor);
  }

  if (value >= acceptableMax) return floor;
  return 1 - ((value - idealMax) / (acceptableMax - idealMax)) * (1 - floor);
};

const rainfallFactor = (totalRainfall, days) => {
  if (!Number.isFinite(totalRainfall)) return 0.75;
  const dailyAverage = totalRainfall / Math.max(days, 1);
  if (dailyAverage >= 2 && dailyAverage <= 8) return 1;
  if (dailyAverage < 2) return 0.78 + (Math.max(dailyAverage, 0) / 2) * 0.22;
  if (dailyAverage < 15) return 1 - ((dailyAverage - 8) / 7) * 0.14;
  return Math.max(0.65, 0.86 - ((dailyAverage - 15) / 20) * 0.21);
};

const weightedGeometricMean = (items) => Math.exp(
  items.reduce((total, item) => total + item.weight * Math.log(Math.max(item.value, 0.01)), 0),
);

router.post(
  '/yield/sinturis',
  [
    body('latitude').optional().isFloat({ min: -90, max: 90 }),
    body('longitude').optional().isFloat({ min: -180, max: 180 }),
    body('days').optional().isInt({ min: 1, max: 16 }),
    body('baseYield').optional().isFloat({ min: 1, max: 200000 }),
    body('farmSizeHectares').optional().isFloat({ min: 0.01, max: 100000 }),
    body('moisture').optional().isFloat({ min: 0, max: 100 }),
    body('avgTemp').optional().isFloat({ min: -20, max: 60 }),
    body('precipitation').optional().isFloat({ min: 0 }),
    body('ph').optional().isFloat({ min: 0, max: 14 }),
    body('n').optional().isFloat({ min: 0 }),
    body('p').optional().isFloat({ min: 0 }),
    body('k').optional().isFloat({ min: 0 }),
  ],
  checkValidation,
  async (req, res) => {
    try {
      const latestSoil = monitoringService.getLatestSoil();
      const fromPayloadOrSoil = (key, fallback = null) => asNumber(req.body[key]) ?? asNumber(latestSoil?.[key]) ?? fallback;

      const baseYield = asNumber(req.body.baseYield) ?? 1000;
      const farmSizeHectares = asNumber(req.body.farmSizeHectares) ?? 1;
      const days = asNumber(req.body.days) ?? 5;
      const moisture = fromPayloadOrSoil('moisture');
      const ph = fromPayloadOrSoil('ph');
      const n = fromPayloadOrSoil('n');
      const p = fromPayloadOrSoil('p');
      const k = fromPayloadOrSoil('k');
      let avgTemp = asNumber(req.body.avgTemp);
      let precipitation = asNumber(req.body.precipitation);
      let weatherSource = req.body.weatherSource || null;

      const latitude = asNumber(req.body.latitude);
      const longitude = asNumber(req.body.longitude);
      if ((avgTemp === null || precipitation === null) && latitude !== null && longitude !== null) {
        try {
          const forecast = await fetchWeatherForecast(latitude, longitude, days);
          const maxTemps = forecast.daily?.temperature_2m_max || [];
          const minTemps = forecast.daily?.temperature_2m_min || [];
          const meanTemps = maxTemps.map((value, index) => average([Number(value), Number(minTemps[index])]));
          avgTemp ??= average(meanTemps);
          precipitation ??= sum((forecast.daily?.precipitation_sum || []).map(Number));
          weatherSource = 'open-meteo';
        } catch {
          weatherSource = 'fallback';
        }
      }

      avgTemp ??= fromPayloadOrSoil('temperature', 27);
      precipitation ??= 0;

      const nutrientComponents = {
        n: bandFactor(n, [40, 65], [20, 90]),
        p: bandFactor(p, [25, 40], [12, 65]),
        k: bandFactor(k, [40, 70], [20, 100]),
      };
      const nutrientFactor = weightedGeometricMean([
        { value: nutrientComponents.n, weight: 0.36 },
        { value: nutrientComponents.p, weight: 0.28 },
        { value: nutrientComponents.k, weight: 0.36 },
      ]);

      const factors = {
        moistureFactor: bandFactor(moisture, [35, 55], [20, 70]),
        temperatureFactor: bandFactor(avgTemp, [23, 30], [15, 36]),
        rainfallFactor: rainfallFactor(precipitation, days),
        nutrientFactor,
        phFactor: bandFactor(ph, [5.5, 6.8], [4.8, 7.8]),
        nutrientComponents,
      };

      const yieldFactor = weightedGeometricMean([
        { value: factors.moistureFactor, weight: 0.24 },
        { value: factors.temperatureFactor, weight: 0.18 },
        { value: factors.rainfallFactor, weight: 0.12 },
        { value: factors.nutrientFactor, weight: 0.31 },
        { value: factors.phFactor, weight: 0.15 },
      ]);

      const availableInputs = [moisture, avgTemp, precipitation, ph, n, p, k].filter(Number.isFinite).length;
      let confidence = 0.45 + (availableInputs / 7) * 0.42;
      if ((req.body.soilSource || latestSoil?.source) === 'demo') confidence -= 0.20;
      if (weatherSource !== 'open-meteo') confidence -= 0.10;
      confidence = Math.min(0.92, Math.max(0.35, confidence));

      const predictedYield = Math.max(0, Math.round(baseYield * yieldFactor));
      const uncertainty = 0.10 + (1 - confidence) * 0.22;
      const yieldRange = {
        low: Math.max(0, Math.round(predictedYield * (1 - uncertainty))),
        high: Math.round(predictedYield * (1 + uncertainty)),
      };
      const predictedHarvest = Math.max(0, Math.round(predictedYield * farmSizeHectares));
      const harvestRange = {
        low: Math.max(0, Math.round(yieldRange.low * farmSizeHectares)),
        high: Math.round(yieldRange.high * farmSizeHectares),
      };

      const observations = [];
      if ((req.body.soilSource || latestSoil?.source) === 'demo') {
        observations.push('Demo soil telemetry limits confidence; calibrate the IoT sensor against a laboratory soil test.');
      }
      const factorLabels = [
        ['moistureFactor', 'Root-zone moisture'],
        ['temperatureFactor', 'Temperature'],
        ['rainfallFactor', 'Forecast rainfall'],
        ['nutrientFactor', 'NPK balance'],
        ['phFactor', 'Soil pH'],
      ];
      factorLabels
        .filter(([key]) => factors[key] < 0.90)
        .sort(([a], [b]) => factors[a] - factors[b])
        .slice(0, 2)
        .forEach(([key, label]) => observations.push(`${label} is reducing the modeled yield potential.`));
      if (!observations.length) observations.push('Current inputs are within the configured citrus suitability ranges.');

      return res.json({
        crop: 'Sinturis (Philippine mandarin)',
        modelVersion: 'citrus-heuristic-v2',
        predictedYield,
        yieldRange,
        predictedHarvest,
        harvestRange,
        farmSizeHectares,
        yieldFactor: Number(yieldFactor.toFixed(4)),
        confidence: {
          score: Math.round(confidence * 100),
          level: confidence >= 0.78 ? 'High' : confidence >= 0.58 ? 'Moderate' : 'Low',
        },
        factors,
        observations,
        inputs: {
          baseYield,
          farmSizeHectares,
          moisture,
          avgTemp,
          precipitation,
          forecastDays: days,
          ph,
          n,
          p,
          k,
          soilSource: req.body.soilSource || latestSoil?.source || 'unknown',
          weatherSource: weatherSource || 'unknown',
        },
        timestamp: new Date().toISOString(),
        disclaimer: 'Decision-support estimate only; calibrate with farm yield records and validated sensor or laboratory data.',
      });
    } catch (error) {
      return res.status(500).json({ error: 'Yield prediction failed', details: error.message });
    }
  },
);

export default router;
