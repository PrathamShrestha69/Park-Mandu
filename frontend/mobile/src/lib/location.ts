import * as Location from "expo-location";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Linking } from "react-native";

export interface Coords {
  latitude: number;
  longitude: number;
}

/**
 * - checking: permission is being read or the first fix is on its way
 * - granted: `coords` holds the device position
 * - denied: the user said no, but can still be asked again
 * - blocked: the user said no for good; only the system settings can change it
 * - unavailable: location services are switched off, or no fix could be obtained
 */
export type LocationStatus = "checking" | "granted" | "denied" | "blocked" | "unavailable";

interface LocationState {
  coords: Coords | null;
  status: LocationStatus;
  busy: boolean;
}

// One shared position for the whole app, so Home, Map and details agree and the user is asked once.
let state: LocationState = { coords: null, status: "checking", busy: false };
const listeners = new Set<() => void>();
let started = false;

function update(next: Partial<LocationState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readPosition(): Promise<void> {
  // The last known fix shows results at once; a fresh fix then corrects it.
  const last = await Location.getLastKnownPositionAsync().catch(() => null);
  if (last) update({ coords: { latitude: last.coords.latitude, longitude: last.coords.longitude }, status: "granted" });
  const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  update({ coords: { latitude: current.coords.latitude, longitude: current.coords.longitude }, status: "granted" });
}

/** Resolves the device position. With `ask` the system permission dialog is shown when still allowed. */
async function resolve(ask: boolean): Promise<void> {
  if (state.busy) return;
  update({ busy: true });
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      update({ status: "unavailable" });
      return;
    }
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && permission.canAskAgain && ask) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (!permission.granted) {
      update({ coords: null, status: permission.canAskAgain ? "denied" : "blocked" });
      return;
    }
    await readPosition();
  } catch {
    // Permission is fine but no fix arrived (indoors, airplane mode…). Keep an earlier fix if there is one.
    if (!state.coords) update({ status: "unavailable" });
  } finally {
    update({ busy: false });
  }
}

/**
 * The device position, shared by every screen. The first screen that uses it asks for permission
 * once; after a refusal nothing is assumed and screens fall back to results without distances.
 */
export function useMyLocation(askOnMount = true) {
  const snapshot = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (!askOnMount || started) return;
    started = true;
    void resolve(true);
  }, [askOnMount]);

  /**
   * For "Near me" buttons: asks again when possible, otherwise opens the system settings.
   * Resolves to the position, or null when none could be obtained.
   */
  const locate = useCallback(async (): Promise<Coords | null> => {
    if (state.status === "blocked") {
      await Linking.openSettings().catch(() => undefined);
      return null;
    }
    await resolve(true);
    return state.status === "granted" ? state.coords : null;
  }, []);

  return { ...snapshot, locate };
}

/** The latest status outside React, e.g. to explain a failed "use my location" press. */
export const currentLocationStatus = (): LocationStatus => state.status;

/** What to tell the user, and what the button does, when no position is available. */
export function locationHelp(status: LocationStatus): { title: string; body: string; action: string } | null {
  switch (status) {
    case "denied":
      return { title: "Location is off", body: "Allow location to see the parking closest to you and how far it is.", action: "Allow location" };
    case "blocked":
      return { title: "Location is blocked", body: "Location access for Park Mandu is turned off in your phone's settings. You can still search by area.", action: "Open settings" };
    case "unavailable":
      return { title: "Can't find your location", body: "Turn on location services or move somewhere with a clearer signal. You can still search by area.", action: "Try again" };
    default:
      return null;
  }
}

