export type WeatherLocationResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country?: string;
  admin1?: string;
};

export type WeatherForecast = {
  location: {
    label: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    temperatureF: number;
    humidity: number;
    windMph: number;
    gustMph: number;
    weatherCode: number;
    weatherLabel: string;
    precipitationIn: number;
    observedAt: string;
  };
  today: {
    highF: number;
    lowF: number;
    rainChance: number;
    uvIndex: number;
    sunrise?: string;
    sunset?: string;
  };
  next12Hours: Array<{
    time: string;
    temperatureF: number;
    rainChance: number;
    windMph: number;
    weatherLabel: string;
  }>;
  notes: {
    turnout: string;
    hauling: string;
    breeding: string;
  };
};

function weatherLabelFromCode(code: number) {
  if (code === 0) return 'Clear';
  if ([1, 2].includes(code)) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Storm';
  return 'Weather';
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatHourLabel(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDayTime(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function describeOperationalNotes(params: {
  currentTempF: number;
  maxRainChance: number;
  maxWindMph: number;
  uvIndex: number;
  weatherCode: number;
}) {
  const stormy = params.maxRainChance >= 65 || params.maxWindMph >= 28 || [95, 96, 99].includes(params.weatherCode);
  const hot = params.currentTempF >= 92;
  const cold = params.currentTempF <= 28;

  return {
    turnout: stormy
      ? 'Limit turnout and keep shelter or stall options ready.'
      : hot
        ? 'Use early and late turnout windows, then lean on shade and water through peak heat.'
        : cold
          ? 'Watch water, footing, and blanketing before turnout.'
          : 'Turnout window looks workable with normal checks.',
    hauling: stormy
      ? 'Hold hauling unless travel is essential. Wind and precip are elevated.'
      : params.maxWindMph >= 20
        ? 'Hauling is workable, but crosswind and trailer heat checks matter today.'
        : 'Hauling window looks stable for routine movement.',
    breeding: hot
      ? 'Schedule palpation, teasing, and checks in the cooler morning window.'
      : cold
        ? 'Use warmer handling windows and keep mares or foals out of harsh exposure.'
        : params.uvIndex >= 8
          ? 'Plan breeding and handling work early before heat and UV build.'
          : 'Breeding and handling windows look normal today.',
  };
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Weather request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

export async function searchWeatherLocations(query: string): Promise<WeatherLocationResult[]> {
  const name = query.trim();
  if (name.length < 2) {
    return [];
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const payload = await readJson<{ results?: WeatherLocationResult[] }>(url.toString());
  return payload.results ?? [];
}

export async function loadWeatherForecast(params: {
  latitude: number;
  longitude: number;
  timezone?: string;
  label: string;
}): Promise<WeatherForecast> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(params.latitude));
  url.searchParams.set('longitude', String(params.longitude));
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('precipitation_unit', 'inch');
  url.searchParams.set('timezone', params.timezone || 'auto');
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
      'precipitation',
    ].join(','),
  );
  url.searchParams.set(
    'hourly',
    [
      'temperature_2m',
      'precipitation_probability',
      'wind_speed_10m',
      'weather_code',
    ].join(','),
  );
  url.searchParams.set(
    'daily',
    [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'uv_index_max',
      'sunrise',
      'sunset',
    ].join(','),
  );
  url.searchParams.set('forecast_days', '3');

  const payload = await readJson<{
    timezone: string;
    current: {
      time: string;
      temperature_2m: number;
      relative_humidity_2m: number;
      weather_code: number;
      wind_speed_10m: number;
      wind_gusts_10m: number;
      precipitation: number;
    };
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: number[];
      wind_speed_10m: number[];
      weather_code: number[];
    };
    daily: {
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
      uv_index_max: number[];
      sunrise: string[];
      sunset: string[];
    };
  }>(url.toString());

  const next12Hours = payload.hourly.time.slice(0, 12).map((time, index) => ({
    time: formatHourLabel(time),
    temperatureF: round(payload.hourly.temperature_2m[index]),
    rainChance: round(payload.hourly.precipitation_probability[index] ?? 0),
    windMph: round(payload.hourly.wind_speed_10m[index] ?? 0),
    weatherLabel: weatherLabelFromCode(payload.hourly.weather_code[index] ?? payload.current.weather_code),
  }));

  const maxRainChance = next12Hours.reduce((max, hour) => Math.max(max, hour.rainChance), payload.daily.precipitation_probability_max[0] ?? 0);
  const maxWindMph = next12Hours.reduce((max, hour) => Math.max(max, hour.windMph), payload.current.wind_gusts_10m ?? 0);
  const notes = describeOperationalNotes({
    currentTempF: payload.current.temperature_2m,
    maxRainChance,
    maxWindMph,
    uvIndex: payload.daily.uv_index_max[0] ?? 0,
    weatherCode: payload.current.weather_code,
  });

  return {
    location: {
      label: params.label,
      latitude: params.latitude,
      longitude: params.longitude,
      timezone: payload.timezone,
    },
    current: {
      temperatureF: round(payload.current.temperature_2m),
      humidity: round(payload.current.relative_humidity_2m),
      windMph: round(payload.current.wind_speed_10m),
      gustMph: round(payload.current.wind_gusts_10m),
      weatherCode: payload.current.weather_code,
      weatherLabel: weatherLabelFromCode(payload.current.weather_code),
      precipitationIn: round(payload.current.precipitation, 2),
      observedAt: formatHourLabel(payload.current.time),
    },
    today: {
      highF: round(payload.daily.temperature_2m_max[0] ?? payload.current.temperature_2m),
      lowF: round(payload.daily.temperature_2m_min[0] ?? payload.current.temperature_2m),
      rainChance: round(payload.daily.precipitation_probability_max[0] ?? maxRainChance),
      uvIndex: round(payload.daily.uv_index_max[0] ?? 0),
      sunrise: formatDayTime(payload.daily.sunrise[0]),
      sunset: formatDayTime(payload.daily.sunset[0]),
    },
    next12Hours,
    notes,
  };
}

export async function resolveWeatherByQuery(query: string): Promise<WeatherForecast> {
  const results = await searchWeatherLocations(query);
  const first = results[0];

  if (!first) {
    throw new Error('No weather match was found for that ranch or town.');
  }

  return loadWeatherForecast({
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone,
    label: [first.name, first.admin1, first.country].filter(Boolean).join(', '),
  });
}
