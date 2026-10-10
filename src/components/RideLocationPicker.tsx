import { useEffect, useRef, useState, useCallback } from 'react';

type Point = {
  coords: [number, number]; // [lng, lat]
  address: string;
};

type Target = 'pickup' | 'destination';

export type TripLocations = {
  pickup: Point | null;
  destination: Point | null;
  distanceKm: number | null;
};

// Central Freetown (Charles Street / Pademba Road area - ON LAND)
const FREETOWN_CENTER = { lat: 8.4808, lng: -13.2290 };

export function RideLocationPicker({
  onChange
}: {
  onChange: (value: TripLocations) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMap = useRef<google.maps.Map | null>(null);

  const pickupMarker = useRef<google.maps.Marker | null>(null);
  const destMarker = useRef<google.maps.Marker | null>(null);
  const directionsRenderer = useRef<google.maps.DirectionsRenderer | null>(null);

  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);

  const [texts, setTexts] = useState({ pickup: '', destination: '' });
  const [searching, setSearching] = useState<Target | null>(null);
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [pinTarget, setPinTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState('');
  const [routing, setRouting] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const value = useRef<TripLocations>({
    pickup: null,
    destination: null,
    distanceKm: null
  });

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const emit = useCallback(() => {
    onChange({ ...value.current });
  }, [onChange]);

  // Load Google Maps Script
  useEffect(() => {
    if (window.google?.maps) {
      setIsLoaded(true);
      return;
    }

    if (!apiKey) {
      setMessage('Google Maps API Key is missing in VITE_GOOGLE_MAPS_API_KEY.');
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => setIsLoaded(true);
    script.onerror = () => setMessage('Failed to load Google Maps SDK.');
    document.head.appendChild(script);
  }, [apiKey]);

  // Initialize Map
  useEffect(() => {
    if (!isLoaded || !mapRef.current || googleMap.current) return;

    const map = new google.maps.Map(mapRef.current, {
      center: FREETOWN_CENTER,
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
    });

    googleMap.current = map;
    autocompleteService.current = new google.maps.places.AutocompleteService();
    geocoder.current = new google.maps.Geocoder();

    directionsRenderer.current = new google.maps.DirectionsRenderer({
      map,
      polylineOptions: { strokeColor: '#2563EB', strokeWeight: 5 }
    });

    // Map Click Handler for Pin Placement
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      if (pinTarget) {
        selectLocation(pinTarget, [lng, lat]);
        setPinTarget(null);
      }
    });

    // Attempt live location on load
    locateUser(false);
  }, [isLoaded]);

  // Place or Update Markers
  const updateMarker = (target: Target, coords: [number, number]) => {
    const position = { lat: coords[1], lng: coords[0] };
    const isPickup = target === 'pickup';
    let marker = isPickup ? pickupMarker.current : destMarker.current;

    if (!marker) {
      marker = new google.maps.Marker({
        position,
        map: googleMap.current,
        draggable: true,
        icon: {
          url: isPickup
            ? 'http://maps.google.com/mapfiles/ms/icons/green-dot.png'
            : 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
        }
      });

      marker.addListener('dragend', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        selectLocation(target, [e.latLng.lng(), e.latLng.lat()]);
      });

      if (isPickup) pickupMarker.current = marker;
      else destMarker.current = marker;
    } else {
      marker.setPosition(position);
    }

    googleMap.current?.panTo(position);
  };

  // Select a location by coords & reverse geocode
  const selectLocation = (target: Target, coords: [number, number], formattedAddress?: string) => {
    updateMarker(target, coords);

    if (formattedAddress) {
      value.current[target] = { coords, address: formattedAddress };
      setTexts(prev => ({ ...prev, [target]: formattedAddress }));
      emit();
    } else if (geocoder.current) {
      geocoder.current.geocode({ location: { lat: coords[1], lng: coords[0] } }, (results, status) => {
        const address = (status === 'OK' && results?.[0])
          ? results[0].formatted_address
          : `${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`;

        value.current[target] = { coords, address };
        setTexts(prev => ({ ...prev, [target]: address }));
        emit();
      });
    }

    setPredictions([]);
    setSearching(null);
  };

  // Locate User via Browser GPS
  const locateUser = (explicit = true) => {
    if (!navigator.geolocation) {
      if (explicit) setMessage('Live GPS is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        selectLocation('pickup', coords);
        setMessage('Live pickup location detected.');
      },
      () => {
        if (explicit) setMessage('Location permission denied or unavailable. Type an address or place a pin.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
  };

  // Handle Input Typing & Google Places Predictions
  const handleInputChange = (target: Target, text: string) => {
    setTexts(prev => ({ ...prev, [target]: text }));
    setSearching(target);

    if (text.trim().length < 2) {
      setPredictions([]);
      return;
    }

    if (!autocompleteService.current) return;

    autocompleteService.current.getPlacePredictions(
      {
        input: text,
        componentRestrictions: { country: 'sl' }, // Restricted to Sierra Leone
        locationRestriction: {
          north: 8.520,
          south: 8.400,
          east: -13.150,
          west: -13.300
        } // Freetown bounding area
      },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          setPredictions(results);
          setMessage('');
        } else {
          setPredictions([]);
          setMessage('No address matches found.');
        }
      }
    );
  };

  // Select Prediction Item
  const handleSelectPrediction = (prediction: google.maps.places.AutocompletePrediction) => {
    if (!geocoder.current) return;

    geocoder.current.geocode({ placeId: prediction.place_id }, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        const loc = results[0].geometry.location;
        selectLocation(searching || 'pickup', [loc.lng(), loc.lat()], prediction.description);
      }
    });
  };

  // Route Preview Calculation
  const previewRoute = () => {
    const { pickup, destination } = value.current;
    if (!pickup || !destination) {
      setMessage('Select both pickup and destination first.');
      return;
    }

    setRouting(true);
    setMessage('');

    const ds = new google.maps.DirectionsService();
    ds.route(
      {
        origin: { lat: pickup.coords[1], lng: pickup.coords[0] },
        destination: { lat: destination.coords[1], lng: destination.coords[0] },
        travelMode: google.maps.TravelMode.DRIVING
      },
      (result, status) => {
        setRouting(false);
        if (status === 'OK' && result?.routes?.[0]?.legs?.[0]) {
          directionsRenderer.current?.setDirections(result);
          const distKm = (result.routes[0].legs[0].distance?.value || 0) / 1000;
          setDistance(distKm);
          value.current.distanceKm = distKm;
          emit();
        } else {
          setMessage('Unable to calculate driving route between selected points.');
        }
      }
    );
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
                placeholder={`Type ${target} (e.g. Syke Street, Stadium)`}
                onFocus={() => setSearching(target)}
                onChange={e => handleInputChange(target, e.target.value)}
                className="mt-1 w-full rounded-xl border p-3 font-normal outline-none focus:border-blue-500"
              />
            </label>

            {searching === target && predictions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 max-h-60 overflow-y-auto rounded-xl border bg-white shadow-xl">
                {predictions.map(item => (
                  <button
                    key={item.place_id}
                    className="block w-full border-b p-3 text-left text-sm hover:bg-slate-50"
                    onClick={() => handleSelectPrediction(item)}
                  >
                    <p className="font-bold text-slate-800">{item.structured_formatting.main_text}</p>
                    <p className="text-xs text-slate-500">{item.structured_formatting.secondary_text}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => locateUser(true)} className="rounded-xl border p-2 text-sm font-bold hover:bg-slate-50">
          Use my live location
        </button>
        {(['pickup', 'destination'] as Target[]).map(target => (
          <button
            key={target}
            onClick={() => {
              setPinTarget(target);
              setMessage(`Tap the map to place the ${target} pin.`);
            }}
            className={`rounded-xl border p-2 text-sm font-bold transition ${pinTarget === target ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}`}
          >
            Pin {target}
          </button>
        ))}
        <button
          onClick={previewRoute}
          disabled={routing}
          className="rounded-xl bg-slate-900 p-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {routing ? 'Finding route...' : 'Preview route'}
        </button>
      </div>

      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm font-medium">{message}</p>}
      {distance !== null && <p className="text-sm font-bold text-emerald-600">Route Distance: {distance.toFixed(1)} km</p>}

      <div ref={mapRef} className="h-[350px] w-full rounded-2xl sm:h-[450px] lg:h-[600px]" />
    </section>
  );
}