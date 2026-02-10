import { useCallback, useEffect, useMemo, useState } from "react";
import { readJson, writeJson } from "../lib/storage";
import type { ConnectionProfile, NewProfileInput } from "../types";

const PROFILES_KEY = "ken.desktop.profiles.v1";
const SELECTED_PROFILE_KEY = "ken.desktop.selectedProfileId.v1";
const LOCAL_DEV_ID = "local-dev";

function currentTimeIso(): string {
  return new Date().toISOString();
}

function normalizeUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `profile-${Date.now()}`;
}

function localDevProfile(): ConnectionProfile {
  const now = currentTimeIso();
  return {
    id: LOCAL_DEV_ID,
    name: "Local Dev",
    baseUrl: "http://127.0.0.1:8000",
    kind: "local_dev",
    createdAt: now,
    updatedAt: now
  };
}

function ensureLocalDevProfile(profiles: ConnectionProfile[]): ConnectionProfile[] {
  if (profiles.some((profile) => profile.id === LOCAL_DEV_ID)) {
    return profiles;
  }
  return [localDevProfile(), ...profiles];
}

function loadProfiles(): ConnectionProfile[] {
  const loaded = readJson<ConnectionProfile[]>(PROFILES_KEY, []);
  if (loaded.length === 0) {
    return [localDevProfile()];
  }
  return ensureLocalDevProfile(loaded);
}

function loadSelectedProfileId(profiles: ConnectionProfile[]): string {
  const saved = localStorage.getItem(SELECTED_PROFILE_KEY);
  if (saved && profiles.some((profile) => profile.id === saved)) {
    return saved;
  }
  return profiles[0]?.id ?? LOCAL_DEV_ID;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(() => loadProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() =>
    loadSelectedProfileId(loadProfiles())
  );

  useEffect(() => {
    writeJson(PROFILES_KEY, profiles);
  }, [profiles]);

  useEffect(() => {
    localStorage.setItem(SELECTED_PROFILE_KEY, selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    if (profiles.length === 0) {
      const fallback = localDevProfile();
      setProfiles([fallback]);
      setSelectedProfileId(fallback.id);
      return;
    }

    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId]
  );

  const createProfile = useCallback((input: NewProfileInput) => {
    const now = currentTimeIso();
    const profile: ConnectionProfile = {
      id: createId(),
      name: input.name.trim(),
      baseUrl: normalizeUrl(input.baseUrl),
      kind: input.kind,
      createdAt: now,
      updatedAt: now
    };

    setProfiles((current) => [...current, profile]);
    setSelectedProfileId(profile.id);
  }, []);

  const updateProfile = useCallback((profileId: string, input: NewProfileInput) => {
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              name: input.name.trim(),
              baseUrl: normalizeUrl(input.baseUrl),
              kind: input.kind,
              updatedAt: currentTimeIso()
            }
          : profile
      )
    );
  }, []);

  const deleteProfile = useCallback(
    (profileId: string) => {
      setProfiles((current) => {
        if (current.length <= 1) {
          return current;
        }

        const nextProfiles = current.filter((profile) => profile.id !== profileId);
        if (nextProfiles.length === 0) {
          return current;
        }

        if (selectedProfileId === profileId) {
          setSelectedProfileId(nextProfiles[0].id);
        }

        return nextProfiles;
      });
    },
    [selectedProfileId]
  );

  const selectProfile = useCallback((profileId: string) => {
    setSelectedProfileId(profileId);
  }, []);

  return {
    profiles,
    selectedProfile,
    selectedProfileId,
    createProfile,
    updateProfile,
    deleteProfile,
    selectProfile
  };
}

