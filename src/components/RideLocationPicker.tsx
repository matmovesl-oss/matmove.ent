import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

type Point = {
  coords: [number, number];
  address: string;
};

type Target = 'pickup' | 'destination';

export type TripLocations = {
  pickup: Point | null;
  destination: Point | null;
  distanceKm: number | null;
};

const fallback: [number, number] = [-13.234, 8.484];

const label = (feature: any) =>
  feature.properties?.full_address ||
  [feature.properties?.name, feature.properties?.place_formatted]
    .filter(Boolean)
    .join(', ');

export function RideLocationPicker({
  onChange
}: {
  onChange: (value: TripLocations) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  const markers = useRef<Partial<Record<Target, mapboxgl.Marker>>>({});
  const callback = useRef(onChange);
  callback.current = onChange;

  const value = useRef<TripLocations>({
    pickup: null,
    destination: null,
    distanceKm: null
  });

  const manualPickup = useRef(false);
  const active = useRef(true);
  const pinTarget = useRef<Target | null>(null);

  const reverseRequests = useRef<Partial<Record<Target, AbortController>>>({});
  const routeRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);

  const [texts, setTexts] = useState({ pickup: '', destination: '' });
  const [searching, setSearching] = useState<Target | null>(null);
  const [results, setResults] = useState<any[]>([]);
  const [pin, setPin] = useState<Target | null>(null);
  const [message, setMessage] = useState('');
  const [routing, setRouting] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);

  const token = import.meta.env.VITE_MAPBOX_TOKEN;

  const emit = () => {
    callback.current({ ...value.current });
  };

  const invalidateRoute = () => {
    routeRequest.current?.abort();
    setRouting(false);
    setDistance(null);
    value.current.distanceKm = null;

    const instance = map.current;
    if (instance?.getLayer('trip-route')) instance.removeLayer('trip-route');
    if (instance?.getSource('trip-route')) instance.removeSource('trip-route');
  };

  const select = (
    target: Target,
    coords: [number, number],
    address: string,
    pan = true
  ) => {
    if (!active.current) return;

    reverseRequests.current[target]?.abort();
    invalidateRoute();

    value.current[target] = { coords, address };
    setTexts(prev => ({ ...prev, [target]: address }));
    setResults([]);
    setSearching(null);

    const instance = map.current;
    if (instance) {
      let marker = markers.current[target];
      if (!marker) {
        marker = new mapboxgl.Marker({
          color: target === 'pickup' ? '#10B981' : '#2563EB',
          draggable: true
        });

        marker.on('dragend', () => {
          const pos = marker!.getLngLat();
          if (target === 'pickup') manualPickup.current = true;
          void selectPin(target, [pos.lng, pos.lat]);
        });

        markers.current[target] = marker;
      }

      marker.setLngLat(coords).addTo(instance);
      if (pan) instance.flyTo({ center: coords, zoom: 15 });
    }

    emit();
  };

  const selectPin = async (target: Target, coords: [number, number]) => {
    select(target, coords, `${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`, false);

    if (!token) return;

    const controller = new AbortController();
    reverseRequests.current[target] = controller;

    try {
      const params = new URLSearchParams({
        longitude: String(coords[0]),
        latitude: String(coords[1]),
        access_token: token,
        permanent: 'true'
      });

      const res = await fetch(
        `https://api.mapbox.com/search/geocode/v6/reverse?${params}`,
        { signal: controller.signal }
      );

      if (!res.ok) return;

      const data = await res.json();
      const address = label(data.features?.[0] || {});

      if (active.current && !controller.signal.aborted && address) {
        value.current[target] = { coords, address };
        setTexts(prev => ({ ...prev, [target]: address }));
        emit();
      }
    } catch {
      // Keep exact pin coordinates
    }
  };

  const locate = (explicit = true) => {
    if (!navigator.geolocation) {
      setMessage('Live location is unavailable. Type an address or place a pin.');
      return;
    }

    if (explicit) manualPickup.current = false;

    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!active.current || manualPickup.current) return;
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        void selectPin('pickup', coords);
        map.current?.flyTo({ center: coords, zoom: 15 });
        setMessage('Live pickup selected. You can change it by typing or dragging the pin.');
      },
      () => {
        if (active.current) {
          setMessage('Location permission is unavailable. Type an address or choose a pin.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  useEffect(() => {
    active.current = true;
    let observer: ResizeObserver | undefined;
    let instance: mapboxgl.Map | undefined;

    const resize = () => {
      if (active.current) instance?.resize();
    };

    try {
      if (!token || !mapboxgl.supported() || !container.current) throw new Error();

      mapboxgl.accessToken = token;
      instance = new mapboxgl.Map({
        container: container.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: fallback,
        zoom: 12
      });

      map.current = instance;
      instance.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

      instance.on('click', event => {
        const target = pinTarget.current;
        if (!target) return;
        if (target === 'pickup') manualPickup.current = true;
        void selectPin(target, [event.lngLat.lng, event.lngLat.lat]);
        pinTarget.current = null;
        setPin(null);
      });

      instance.on('error', () => {
        if (active.current) {
          setMessage('Map tiles could not load. Check connection or type an address.');
        }
      });

      instance.once('load', resize);

      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(resize);
        observer.observe(container.current);
      }

      window.addEventListener('resize', resize);
    } catch {
      setMessage('Map is unavailable. Address search remains available with a valid Mapbox token.');
    }

    locate(false);

    return () => {
      active.current = false;
      observer?.disconnect();
      window.removeEventListener('resize', resize);

      searchRequest.current?.abort();
      routeRequest.current?.abort();

      Object.values(reverseRequests.current).forEach(c => c?.abort());
      Object.values(markers.current).forEach(m => m?.remove());

      markers.current = {};
      instance?.remove();
      map.current = null;
    };
  }, [token]);

  useEffect(() => {
    searchRequest.current?.abort();
    setResults([]);

    if (!searching || texts[searching].trim().length < 3 || !token) return;

    const target = searching;
    const query = texts[target].trim();
    const controller = new AbortController();
    searchRequest.current = controller;

    const timer = window.setTimeout(async () => {
      try {
        const center = value.current.pickup?.coords || fallback;
        const params = new URLSearchParams({
          q: query,
          country: 'sl',
          autocomplete: 'true',
          limit: '5',
          proximity: center.join(','),
          access_token: token,
          permanent: 'true'
        });

        const res = await fetch(
          `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
          { signal: controller.signal }
        );

        if (!res.ok) throw new Error('Address search failed.');

        const data = await res.json();
        if (!controller.signal.aborted && active.current) {
          const features = (data.features || []).filter((f: any) =>
            Array.isArray(f.geometry?.coordinates)
          );
          setResults(features);
          setMessage(features.length ? '' : 'No address matches found.');
        }
      } catch (err: any) {
        if (!controller.signal.aborted && active.current) {
          setMessage(err.message);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searching, texts, token]);

  const preview = async () => {
    const { pickup, destination } = value.current;
    if (!pickup || !destination || !token) {
      setMessage('Select both pickup and destination first.');
      return;
    }

    routeRequest.current?.abort();
    const controller = new AbortController();
    routeRequest.current = controller;

    setRouting(true);
    setMessage('');

    try {
      const res = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/` +
        `${pickup.coords.join(',')};${destination.coords.join(',')}` +
        `?geometries=geojson&access_token=${encodeURIComponent(token)}`,
        { signal: controller.signal }
      );

      if (!res.ok) throw new Error('Route preview is unavailable.');

      const data = await res.json();
      const route = data.routes?.[0];

      if (!route || !Number.isFinite(route.distance)) {
        throw new Error('No driving route found between these points.');
      }

      if (!active.current || controller.signal.aborted) return;

      value.current.distanceKm = route.distance / 1000;
      setDistance(value.current.distanceKm);
      emit();

      const instance = map.current;
      if (instance?.isStyleLoaded()) {
        const geojson: any = {
          type: 'Feature',
          properties: {},
          geometry: route.geometry
        };

        if (instance.getSource('trip-route')) {
          (instance.getSource('trip-route') as mapboxgl.GeoJSONSource).setData(geojson);
        } else {
          instance.addSource('trip-route', { type: 'geojson', data: geojson });
          instance.addLayer({
            id: 'trip-route',
            type: 'line',
            source: 'trip-route',
            paint: { 'line-color': '#2563EB', 'line-width': 5 }
          });
        }

        instance.fitBounds(
          new mapboxgl.LngLatBounds(pickup.coords, pickup.coords).extend(destination.coords),
          { padding: 55 }
        );
      }
    } catch (err: any) {
      if (!controller.signal.aborted && active.current) {
        setMessage(err.message || 'Route preview failed.');
      }
    } finally {
      if (!controller.signal.aborted && active.current) {
        setRouting(false);
      }
    }
  };

  return (
    <section className="w-full space-y-3 rounded-3xl border bg-white p-4" onClick={e => e.stopPropagation()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(['pickup', 'destination'] as Target[]).map(target => (
          <div key={target} className="relative">
            <label className="block text-sm font-bold capitalize">
              {target}
              <input
                value={texts[target]}
                placeholder={`Type ${target} address (3+ letters)`}
                onFocus={() => setSearching(target)}
                onChange={e => {
                  if (target === 'pickup') manualPickup.current = true;
                  reverseRequests.current[target]?.abort();
                  invalidateRoute();

                  value.current[target] = null;
                  markers.current[target]?.remove();
                  emit();

                  setTexts(prev => ({ ...prev, [target]: e.target.value }));
                  setSearching(target);
                }}
                className="mt-1 w-full rounded-xl border p-3 font-normal"
              />
            </label>

            {searching === target && results.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 rounded-xl border bg-white shadow-lg">
                {results.map((feature, index) => (
                  <button
                    key={feature.properties?.mapbox_id || index}
                    className="block w-full border-b p-3 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      if (target === 'pickup') manualPickup.current = true;
                      select(
                        target,
                        feature.geometry.coordinates.slice(0, 2) as [number, number],
                        label(feature)
                      );
                    }}
                  >
                    {label(feature)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => locate()} className="rounded-xl border p-2 text-sm font-bold">
          Use my live location
        </button>
        {(['pickup', 'destination'] as Target[]).map(target => (
          <button
            key={target}
            onClick={() => {
              pinTarget.current = target;
              setPin(target);
              setSearching(null);
              setResults([]);
            }}
            className={`rounded-xl border p-2 text-sm font-bold ${pin === target ? 'bg-blue-600 text-white' : ''}`}
          >
            Pin {target}
          </button>
        ))}
        <button
          onClick={() => void preview()}
          disabled={routing}
          className="rounded-xl bg-slate-900 p-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {routing ? 'Finding route...' : 'Preview route'}
        </button>
      </div>

      {pin && (
        <p role="status" className="text-sm font-bold text-blue-700">
          Tap the map to place the {pin} pin. You can drag either pin afterwards.
        </p>
      )}

      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
      {distance !== null && <p className="text-sm font-bold">Route: {distance.toFixed(1)} km</p>}

      <div ref={container} className="h-[350px] w-full rounded-2xl sm:h-[450px] lg:h-[600px]" />
    </section>
  );
}