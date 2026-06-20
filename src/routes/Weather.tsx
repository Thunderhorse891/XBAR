import { FormEvent, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { loadWeatherForecast, resolveWeatherByQuery, searchWeatherLocations, type WeatherForecast, type WeatherLocationResult } from '@/lib/weather';
import { useXbarStore } from '@/store/useXbarStore';

type WeatherState =
  | { status: 'idle' | 'loading'; forecast?: WeatherForecast; error?: string }
  | { status: 'ready'; forecast: WeatherForecast; error?: string }
  | { status: 'error'; forecast?: WeatherForecast; error: string };

export default function Weather() {
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const initialQuery = workspaceProfile.ranchName.trim();
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<WeatherState>({ status: 'idle' });
  const [matches, setMatches] = useState<WeatherLocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [waitingForGeo, setWaitingForGeo] = useState(false);

  useEffect(() => {
    if (!initialQuery) {
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    void resolveWeatherByQuery(initialQuery)
      .then((forecast) => {
        if (!cancelled) {
          setState({ status: 'ready', forecast });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ status: 'error', error: error instanceof Error ? error.message : 'Weather could not load.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialQuery]);

  const handleSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery.length < 2) {
      setState({ status: 'error', error: 'Enter a ranch, town, or postal code.' });
      setMatches([]);
      return;
    }

    setSearching(true);
    setState((current) => ({ status: 'loading', forecast: current.forecast }));
    try {
      const results = await searchWeatherLocations(nextQuery);
      setMatches(results);

      if (!results.length) {
        setState({ status: 'error', error: 'No weather match was found for that ranch or town.' });
        return;
      }

      const first = results[0];
      const forecast = await loadWeatherForecast({
        latitude: first.latitude,
        longitude: first.longitude,
        timezone: first.timezone,
        label: [first.name, first.admin1, first.country].filter(Boolean).join(', '),
      });
      setState({ status: 'ready', forecast });
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : 'Weather could not load.' });
    } finally {
      setSearching(false);
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setState({ status: 'error', error: 'Geolocation is not available in this browser.' });
      return;
    }

    setSearching(true);
    setWaitingForGeo(true);
    setState((current) => ({ status: 'loading', forecast: current.forecast }));
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setWaitingForGeo(false);
        try {
          const forecast = await loadWeatherForecast({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            label: 'Current location',
          });
          setMatches([]);
          setState({ status: 'ready', forecast });
        } catch (error) {
          setState({ status: 'error', error: error instanceof Error ? error.message : 'Weather could not load.' });
        } finally {
          setSearching(false);
        }
      },
      (error) => {
        setWaitingForGeo(false);
        setSearching(false);
        setState({ status: 'error', error: error.message || 'Location access was denied.' });
      },
      { enableHighAccuracy: false, maximumAge: 1000 * 60 * 10, timeout: 10000 },
    );
  };

  const forecast = state.forecast;

  return (
    <>
      <PageHeader
        eyebrow="Ranch tools"
        title="Weather"
        actions={
          <button className="button button--ghost button--compact" type="button" onClick={handleUseMyLocation} disabled={searching}>
            Use my location
          </button>
        }
      />

      <Panel title="Ranch forecast">
        <form className="form-grid form-grid--tight" onSubmit={handleSearch}>
          <label className="field-stack field-stack--wide">
            <span className="field-label">Ranch or town</span>
            <input
              className="field-input field-input--wide"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Weatherford, TX"
            />
          </label>
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="submit" disabled={searching}>
              {searching ? 'Loading...' : 'Load weather'}
            </button>
            {forecast ? <Pill tone="blue">{forecast.location.label}</Pill> : null}
          </div>
          {waitingForGeo && (
            <p className="field-hint">Waiting for browser location permission — check the address bar or a browser prompt.</p>
          )}
        </form>
      </Panel>

      {forecast ? (
        <>
          <div className="metric-grid">
            <MetricCard label="Current temp" value={`${forecast.current.temperatureF}°F`} tone="blue" />
            <MetricCard label="Rain risk" value={`${forecast.today.rainChance}%`} tone={forecast.today.rainChance >= 50 ? 'rose' : 'slate'} />
            <MetricCard label="Wind" value={`${forecast.current.windMph} mph`} detail={`Gusts ${forecast.current.gustMph} mph`} tone={forecast.current.windMph >= 20 ? 'amber' : 'emerald'} />
            <MetricCard label="UV" value={`${forecast.today.uvIndex}`} detail={forecast.current.weatherLabel} tone={forecast.today.uvIndex >= 8 ? 'amber' : 'slate'} />
          </div>

          <div className="detail-grid">
            <Panel title="Today">
              <div className="stack-list">
                <div className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">Daily window</div>
                    <Pill tone="blue">{forecast.current.weatherLabel}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>High {forecast.today.highF}°F</span>
                    <span>Low {forecast.today.lowF}°F</span>
                    <span>Observed {forecast.current.observedAt}</span>
                  </div>
                </div>
                <div className="stack-item">
                  <div className="inline-metrics">
                    <span>Humidity {forecast.current.humidity}%</span>
                    <span>Precip {forecast.current.precipitationIn} in</span>
                    <span>Sunrise {forecast.today.sunrise || 'N/A'} · Sunset {forecast.today.sunset || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Ops notes">
              <div className="stack-list">
                <div className="stack-item">
                  <div className="stack-item__title">Turnout</div>
                  <div className="stack-item__copy">{forecast.notes.turnout}</div>
                </div>
                <div className="stack-item">
                  <div className="stack-item__title">Hauling</div>
                  <div className="stack-item__copy">{forecast.notes.hauling}</div>
                </div>
                <div className="stack-item">
                  <div className="stack-item__title">Breeding work</div>
                  <div className="stack-item__copy">{forecast.notes.breeding}</div>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Next 12 hours">
            <div className="weather-hour-grid">
              {forecast.next12Hours.map((hour) => (
                <div key={hour.time} className="weather-hour-card">
                  <div className="weather-hour-card__time">{hour.time}</div>
                  <div className="weather-hour-card__temp">{hour.temperatureF}°</div>
                  <div className="weather-hour-card__meta">{hour.weatherLabel}</div>
                  <div className="weather-hour-card__meta">{hour.rainChance}% rain</div>
                  <div className="weather-hour-card__meta">{hour.windMph} mph wind</div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : (
        <Panel title="Forecast">
          <EmptyState
            title={state.status === 'loading' ? 'Loading weather' : 'No forecast yet'}
            description={state.error || 'Search for a ranch or use your current location to load weather.'}
          />
        </Panel>
      )}

      {matches.length > 1 ? (
        <Panel title="Location matches">
          <div className="stack-list">
            {matches.slice(1).map((match) => (
              <button
                key={`${match.id}-${match.latitude}-${match.longitude}`}
                type="button"
                className="stack-item stack-item--interactive"
                onClick={async () => {
                  setSearching(true);
                  try {
                    const nextForecast = await loadWeatherForecast({
                      latitude: match.latitude,
                      longitude: match.longitude,
                      timezone: match.timezone,
                      label: [match.name, match.admin1, match.country].filter(Boolean).join(', '),
                    });
                    setState({ status: 'ready', forecast: nextForecast });
                  } catch (error) {
                    setState({ status: 'error', error: error instanceof Error ? error.message : 'Weather could not load.' });
                  } finally {
                    setSearching(false);
                  }
                }}
              >
                <div className="stack-item__title">{[match.name, match.admin1, match.country].filter(Boolean).join(', ')}</div>
                <div className="stack-item__copy">
                  {match.latitude.toFixed(3)}, {match.longitude.toFixed(3)}
                </div>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
