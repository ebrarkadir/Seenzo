import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import {
  fetchOwnFavorites,
  fetchOwnProfile,
  refreshProfileImageUrls,
  replaceProfileImageAndSave,
  saveOwnFavorites,
  updateOwnProfile,
  updateOwnProfileMediaPaths,
} from '../services/supabase/profile';
import { removeProfileObject, uploadProfileImage } from '../services/supabase/profileMedia';
import {
  emptyFavorites,
  emptyProfile,
  normalizeFavoritesList,
  PROFILE_FAVORITES_LIMIT,
  removeFavoriteAt,
  reorderFavorites,
  upsertFavoriteList,
} from '../services/supabase/profileRules';

const ProfileContext = createContext(null);

function unavailable(code) {
  return code === 'favorites_unavailable' || code === 'config';
}

export function ProfileProvider({ children }) {
  const { ready: authReady, session } = useAuth();
  const userId = session?.user?.id || null;
  return (
    <ProfileProviderBody key={userId || 'guest'} authReady={authReady} userId={userId}>
      {children}
    </ProfileProviderBody>
  );
}

function ProfileProviderBody({ children, authReady, userId }) {
  const requestSeq = useRef(0);
  const [profile, setProfile] = useState(emptyProfile());
  const [favorites, setFavorites] = useState(emptyFavorites());
  const [loading, setLoading] = useState(Boolean(userId));
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState(null);
  const [setupUnavailable, setSetupUnavailable] = useState(false);

  useEffect(() => {
    if (!authReady || !userId) {
      return undefined;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    let active = true;
    fetchOwnProfile()
      .then(async (nextProfile) => {
        let nextFavorites = emptyFavorites();
        try {
          nextFavorites = await fetchOwnFavorites();
        } catch (requestError) {
          if (unavailable(requestError.code)) {
            if (active && requestSeq.current === seq) {
              setSetupUnavailable(true);
            }
          } else {
            throw requestError;
          }
        }
        if (!active || requestSeq.current !== seq) {
          return;
        }
        setProfile(nextProfile);
        setFavorites(nextFavorites);
        setError(null);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active || requestSeq.current !== seq) {
          return;
        }
        setProfile(emptyProfile());
        setFavorites(emptyFavorites());
        setError(requestError);
        setLoading(false);
        setSetupUnavailable(unavailable(requestError.code));
      });
    return () => {
      active = false;
    };
  }, [authReady, userId]);

  useEffect(() => {
    if (!userId || !profile?.userId || profile.userId !== userId) {
      return undefined;
    }
    let active = true;
    const timer = setInterval(() => {
      refreshProfileImageUrls(profile).then((next) => {
        if (!active) {
          return;
        }
        setProfile((current) => (
          current.userId === next.userId ? { ...current, ...next } : current
        ));
      });
    }, 10 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [profile, userId]);

  const saveProfile = useCallback(async (fields) => {
    if (!userId) {
      throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
    }
    setSaving(true);
    setError(null);
    try {
      const next = await updateOwnProfile(fields);
      setProfile(next);
      setSetupUnavailable(false);
      return next;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, [userId]);

  const uploadAndSaveImage = useCallback(async (kind, asset) => {
    if (!userId) {
      throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
    }
    setSaving(true);
    setUploadProgress(0);
    setError(null);
    const previousPath = kind === 'avatar' ? profile.avatarPath : profile.bannerPath;
    try {
      const uploaded = await uploadProfileImage({
        userId,
        kind,
        asset,
        onProgress: setUploadProgress,
      });
      const next = await replaceProfileImageAndSave({
        kind,
        uploadedPath: uploaded.path,
        previousPath,
      });
      setProfile(next);
      return next;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  }, [profile.avatarPath, profile.bannerPath, userId]);

  const removeImage = useCallback(async (kind) => {
    if (!userId) {
      throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
    }
    const previousPath = kind === 'avatar' ? profile.avatarPath : profile.bannerPath;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateOwnProfileMediaPaths(
        kind === 'avatar' ? { avatarPath: null } : { bannerPath: null }
      );
      const next = await refreshProfileImageUrls({
        ...saved,
        avatarUrl: null,
        bannerUrl: null,
        avatarExpiresAt: null,
        bannerExpiresAt: null,
      });
      setProfile(next);
      if (previousPath) {
        removeProfileObject(previousPath).catch(() => {});
      }
      return next;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, [profile.avatarPath, profile.bannerPath, userId]);

  const persistFavorites = useCallback(async (mediaType, items) => {
    if (!userId) {
      throw Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
    }
    if (setupUnavailable) {
      throw Object.assign(new Error('favorites_unavailable'), { code: 'favorites_unavailable' });
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveOwnFavorites(mediaType, items);
      setFavorites((current) => ({
        ...current,
        [mediaType === 'movie' ? 'movies' : 'shows']: saved,
      }));
      return saved;
    } catch (requestError) {
      setError(requestError);
      setSetupUnavailable(unavailable(requestError.code));
      throw requestError;
    } finally {
      setSaving(false);
    }
  }, [setupUnavailable, userId]);

  const setFavoriteAt = useCallback(async (mediaType, mediaId, position) => {
    const key = mediaType === 'movie' ? 'movies' : 'shows';
    const current = favorites[key] || [];
    if (current.some((item) => item.mediaId === mediaId && item.position !== position)) {
      throw Object.assign(new Error('duplicate_media'), { code: 'duplicate_media' });
    }
    if (!current.some((item) => item.position === position) && current.length >= PROFILE_FAVORITES_LIMIT) {
      throw Object.assign(new Error('favorites_limit'), { code: 'favorites_limit' });
    }
    const next = upsertFavoriteList(
      current.map((item) => ({ ...item, mediaType })),
      mediaId,
      position,
      mediaType
    );
    return persistFavorites(mediaType, next);
  }, [favorites, persistFavorites]);

  const clearFavoriteAt = useCallback(async (mediaType, position) => {
    const key = mediaType === 'movie' ? 'movies' : 'shows';
    const next = removeFavoriteAt(favorites[key] || [], position).map((item) => ({
      ...item,
      mediaType,
    }));
    return persistFavorites(mediaType, next);
  }, [favorites, persistFavorites]);

  const moveFavorite = useCallback(async (mediaType, fromPosition, toPosition) => {
    const key = mediaType === 'movie' ? 'movies' : 'shows';
    const next = reorderFavorites(favorites[key] || [], fromPosition, toPosition).map((item) => ({
      ...item,
      mediaType,
    }));
    return persistFavorites(mediaType, next);
  }, [favorites, persistFavorites]);

  const value = useMemo(() => ({
    ready: authReady,
    userId,
    profile: userId ? profile : emptyProfile(),
    favorites: userId ? favorites : emptyFavorites(),
    loading: Boolean(userId) && loading,
    saving,
    uploadProgress,
    error,
    setupUnavailable,
    saveProfile,
    uploadAndSaveImage,
    removeImage,
    setFavoriteAt,
    clearFavoriteAt,
    moveFavorite,
    refresh: async () => {
      if (!userId) {
        return;
      }
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      setLoading(true);
      try {
        const nextProfile = await fetchOwnProfile();
        let nextFavorites = emptyFavorites();
        try {
          nextFavorites = await fetchOwnFavorites();
        } catch (requestError) {
          if (unavailable(requestError.code)) {
            setSetupUnavailable(true);
          } else {
            throw requestError;
          }
        }
        if (requestSeq.current !== seq) {
          return;
        }
        setProfile(nextProfile);
        setFavorites(nextFavorites);
        setError(null);
      } catch (requestError) {
        if (requestSeq.current === seq) {
          setError(requestError);
        }
      } finally {
        if (requestSeq.current === seq) {
          setLoading(false);
        }
      }
    },
    normalizeFavoritesList,
  }), [
    authReady,
    clearFavoriteAt,
    error,
    favorites,
    loading,
    moveFavorite,
    profile,
    removeImage,
    saveProfile,
    saving,
    setFavoriteAt,
    setupUnavailable,
    uploadAndSaveImage,
    uploadProgress,
    userId,
  ]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile must be used within ProfileProvider');
  }
  return context;
}
