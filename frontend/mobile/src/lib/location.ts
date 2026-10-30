import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";

export interface Coords {
  latitude: number;
  longitude: number;
}

/** Current device position, requested only when the user asks (or permission was already granted). */
export function useMyLocation(autoIfGranted = true) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [busy, setBusy] = useState(false);

  const locate = useCallback(async (prompt = true) => {
    setBusy(true);
    try {
      const permission = prompt ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        if (prompt) Alert.alert("Location is off", "Allow location access to see parking nearest to you.");
        return null;
      }
      const position = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCoords(next);
      return next;
    } catch {
      if (prompt) Alert.alert("Location unavailable", "We couldn't read your location. Showing parking around central Kathmandu.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  // If permission was granted earlier, show the user's position without prompting again.
  useEffect(() => {
    if (!autoIfGranted) return;
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then(async (permission) => {
        if (!permission.granted || cancelled) return;
        const position = await Location.getLastKnownPositionAsync();
        if (position && !cancelled) setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [autoIfGranted]);

  return { coords, busy, locate };
}
