import {
  useEffect,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

import mapboxgl from 'mapbox-gl';

export function useSafeMap(
  container: RefObject<HTMLDivElement>,
  mapRef: MutableRefObject<mapboxgl.Map | null>,
  section: string,
  onPosition?: (
    coords: [number, number],
    address?: string
  ) => void
) {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (
      section !== 'home' ||
      !container.current
    ) {
      return;
    }

    let disposed = false;
    let instance: mapboxgl.Map | null = null;
    let observer: ResizeObserver | undefined;
    let marker: mapboxgl.Marker | undefined;

    const controller = new AbortController();

    const report = (text: string) => {
      if (!disposed) setMessage(text);
    };

    const locate = async (
      coords: [number, number],
      pan = false
    ) => {
      if (disposed || !instance) return;

      try {
        onPosition?.(coords);

        if (pan) {
          instance.flyTo({
            center: coords,
            zoom: 15,
          });
        }

        if (!marker) {
          marker = new mapboxgl.Marker({
            color: '#10B981',
            draggable: !!onPosition,
          })
            .setLngLat(coords)
            .addTo(instance);

          marker.on('dragend', () => {
            const pos = marker!.getLngLat();
            void locate([pos.lng, pos.lat]);
          });
        } else {
          marker.setLngLat(coords);
        }

        if (onPosition) {
          const response = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${
              coords[0]
            },${
              coords[1]
            }.json?access_token=${
              mapboxgl.accessToken
            }`,
            {
              signal: controller.signal,
            }
          );

          if (!response.ok) return;

          const data = await response.json();

          if (
            !disposed &&
            data.features?.[0]?.place_name
          ) {
            onPosition(
              coords,
              data.features[0].place_name
            );
          }
        }
      } catch {
        if (!disposed) {
          report(
            'Location selected. You can enter the pickup address manually.'
          );
        }
      }
    };

    try {
      const token =
        import.meta.env.VITE_MAPBOX_TOKEN;

      if (
        !token ||
        !mapboxgl.supported()
      ) {
        report(
          'The map is unavailable on this browser. You can still use Wallet, Account and Trips.'
        );
        return;
      }

      setMessage('');
      mapboxgl.accessToken = token;

      instance = new mapboxgl.Map({
        container: container.current,
        style:
          'mapbox://styles/mapbox/streets-v12',
        center: [-13.234, 8.484],
        zoom: 12,
      });

      mapRef.current = instance;

      instance.on('error', () => {
        report(
          'The map could not load fully. Check your connection; other sections remain available.'
        );
      });

      const resize = () => {
        if (!disposed) instance?.resize();
      };

      if (
        typeof ResizeObserver !== 'undefined'
      ) {
        observer = new ResizeObserver(resize);
        observer.observe(container.current);
      }

      window.addEventListener(
        'resize',
        resize
      );

      instance.once('load', resize);

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            if (!disposed) {
              void locate(
                [
                  pos.coords.longitude,
                  pos.coords.latitude,
                ],
                true
              );
            }
          },

          () => {
            report(
              'Live location is unavailable. Search for your pickup address or allow location in browser settings.'
            );
          },

          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 60000,
          }
        );
      }

      return () => {
        disposed = true;
        controller.abort();
        observer?.disconnect();

        window.removeEventListener(
          'resize',
          resize
        );

        marker?.remove();
        instance?.remove();

        if (mapRef.current === instance) {
          mapRef.current = null;
        }
      };
    } catch {
      report(
        'The map is unavailable. Wallet, Account and Trips remain available.'
      );

      disposed = true;
      controller.abort();
      observer?.disconnect();
      instance?.remove();
      mapRef.current = null;
    }
  }, [section, container, mapRef]);

  return message;
}