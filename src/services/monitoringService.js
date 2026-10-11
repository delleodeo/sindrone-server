// In-memory soil telemetry store. Demo readings mirror the payload expected
// from the future field IoT device, so the UI can switch sources unchanged.
const soilReadings = [];

const SOIL_BANDS = {
  moisture: { label: 'Moisture', unit: '%', ideal: [35, 55], acceptable: [20, 70], weight: 0.24 },
  ph: { label: 'pH', unit: '', ideal: [5.5, 6.8], acceptable: [4.8, 7.8], weight: 0.20 },
  n: { label: 'Nitrogen', unit: 'index', ideal: [40, 65], acceptable: [20, 90], weight: 0.17 },
  p: { label: 'Phosphorus', unit: 'index', ideal: [25, 40], acceptable: [12, 65], weight: 0.14 },
  k: { label: 'Potassium', unit: 'index', ideal: [40, 70], acceptable: [20, 100], weight: 0.17 },
  temperature: { label: 'Soil temperature', unit: '°C', ideal: [22, 30], acceptable: [15, 36], weight: 0.08 },
};

const round = (value, digits = 1) => Number(Number(value).toFixed(digits));

const scoreBand = (value, band) => {
  if (!Number.isFinite(value)) return 55;
  const [idealMin, idealMax] = band.ideal;
  const [acceptableMin, acceptableMax] = band.acceptable;

  if (value >= idealMin && value <= idealMax) {
    const midpoint = (idealMin + idealMax) / 2;
    const halfWidth = Math.max((idealMax - idealMin) / 2, 0.01);
    return 90 + (1 - Math.abs(value - midpoint) / halfWidth) * 10;
  }
  if (value < idealMin) {
    if (value <= acceptableMin) return Math.max(20, 60 - ((acceptableMin - value) / Math.max(acceptableMin, 1)) * 40);
    return 60 + ((value - acceptableMin) / (idealMin - acceptableMin)) * 30;
  }
  if (value >= acceptableMax) return Math.max(20, 60 - ((value - acceptableMax) / Math.max(acceptableMax, 1)) * 40);
  return 90 - ((value - idealMax) / (acceptableMax - idealMax)) * 30;
};

const componentStatus = (score) => {
  if (score >= 90) return 'optimal';
  if (score >= 70) return 'watch';
  return 'attention';
};

export const assessSoil = (entry) => {
  if (!entry) return null;

  const components = Object.entries(SOIL_BANDS).map(([key, band]) => {
    const value = Number.isFinite(entry[key]) ? entry[key] : null;
    const score = Math.round(scoreBand(value, band));
    return {
      key,
      label: band.label,
      value,
      unit: band.unit,
      score,
      status: componentStatus(score),
      idealRange: band.ideal,
      weight: band.weight,
    };
  });

  const score = Math.round(components.reduce((sum, item) => sum + item.score * item.weight, 0));
  const grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs attention';
  const attention = components
    .filter((item) => item.status !== 'optimal')
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => item.key);

  return {
    score,
    grade,
    attention,
    components,
    methodology: 'Range-based citrus suitability score; sensor indices require field calibration.',
  };
};

export const addSoilReading = (reading) => {
  const numericValue = (key) => {
    const value = Number(reading[key]);
    return Number.isFinite(value) ? value : null;
  };

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: reading.deviceId || 'unknown',
    source: reading.source || (String(reading.deviceId || '').startsWith('demo') ? 'demo' : 'iot'),
    moisture: numericValue('moisture'),
    temperature: numericValue('temperature'),
    ph: numericValue('ph'),
    n: numericValue('n'),
    p: numericValue('p'),
    k: numericValue('k'),
    battery: numericValue('battery'),
    signalStrength: numericValue('signalStrength'),
    timestamp: reading.timestamp ? new Date(reading.timestamp).toISOString() : new Date().toISOString(),
  };

  soilReadings.push(entry);
  if (soilReadings.length > 500) soilReadings.shift();
  return { ...entry, assessment: assessSoil(entry) };
};

export const getLatestSoil = () => {
  if (soilReadings.length === 0) return null;
  return soilReadings[soilReadings.length - 1];
};

export const getSoilHistory = (limit = 50) => {
  if (limit <= 0) return [];
  return soilReadings.slice(-Math.min(limit, soilReadings.length)).reverse();
};

export const computeSoilQuality = (entry) => assessSoil(entry)?.score ?? null;

const seedDemoReadings = () => {
  if (soilReadings.length) return;
  const now = Date.now();

  for (let index = 11; index >= 0; index -= 1) {
    const phase = (11 - index) / 2.2;
    addSoilReading({
      deviceId: 'demo-citrus-bed-01',
      source: 'demo',
      moisture: round(43.5 + Math.sin(phase) * 3.2),
      temperature: round(27.1 + Math.sin(phase / 1.6) * 1.4),
      ph: round(6.2 + Math.sin(phase / 2.1) * 0.12, 2),
      n: round(49 + Math.sin(phase / 1.8) * 2.4),
      p: round(31 + Math.cos(phase / 2) * 1.5),
      k: round(53 + Math.cos(phase / 1.7) * 2.2),
      battery: 86,
      signalStrength: -67,
      timestamp: new Date(now - index * 30 * 60 * 1000).toISOString(),
    });
  }
};

seedDemoReadings();

export default {
  addSoilReading,
  getLatestSoil,
  getSoilHistory,
  computeSoilQuality,
  assessSoil,
};
