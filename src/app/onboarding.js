import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import PrimaryButton from '../components/ui/PrimaryButton';
import SearchField from '../components/ui/SearchField';
import PosterTile, { posterSize } from '../components/media/PosterTile';
import { episodeTitle, mediaTitle } from '../data/labels';
import { rememberMovie, rememberShow } from '../data/mediaLibrary';
import { colors, radii, spacing, typography } from '../theme';
import { getTraktConfigStatus } from '../services/trakt/config';
import { hydrateShow, searchMoviesPage, searchShowsPage } from '../services/trakt/catalog';
import { useTracking } from '../tracking/TrackingContext';
import { episodeCode, releasedEpisodes } from '../tracking/status';

export default function OnboardingScreen() {
  const { loadDemo, completeOnboarding } = useTracking();
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const [selectedShows, setSelectedShows] = useState({});
  const [selectedMovies, setSelectedMovies] = useState({});
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const config = getTraktConfigStatus();

  useEffect(() => {
    if (step === 1 || !config.ready) {
      return undefined;
    }
    const text = query.trim();
    if (text.length < 2) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      const task = step === 2 ? searchShowsPage(text, 1) : searchMoviesPage(text, 1);
      task
        .then((result) => setResults(result.items))
        .catch((requestError) => {
          setResults([]);
          setSearchError(requestError);
        })
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [config.ready, query, step]);

  const finish = (movieIds) => {
    Object.values(selectedShows).forEach((value) => rememberShow(value.show));
    Object.values(selectedMovies).forEach((movie) => rememberMovie(movie));
    completeOnboarding({
      shows: Object.entries(selectedShows).map(([id, value]) => ({
        id,
        throughEpisodeId: value.throughEpisodeId,
      })),
      movies: movieIds,
    });
    router.replace('/(tabs)');
  };

  const startDemo = () => {
    loadDemo();
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.dots}>
        {[1, 2, 3].map((item) => (
          <View key={item} style={[styles.dot, item === step && styles.dotActive]} />
        ))}
      </View>
      {step === 1 ? (
        <WelcomeStep onStart={() => setStep(2)} onDemo={startDemo} />
      ) : null}
      {step === 2 ? (
        <ShowStep
          query={query}
          onQuery={(text) => {
            setQuery(text);
            if (text.trim().length < 2) {
              setResults([]);
            }
          }}
          results={results}
          searching={searching}
          searchError={searchError}
          configured={config.ready}
          selected={selectedShows}
          onToggle={async (show) => {
            if (selectedShows[show.id]) {
              setSelectedShows((current) => {
                const next = { ...current };
                delete next[show.id];
                return next;
              });
              return;
            }
            setSearching(true);
            try {
              const full = await hydrateShow(show.traktId);
              if (!full) {
                setSearchError({ code: 'invalid' });
                return;
              }
              rememberShow(full);
              setSelectedShows((current) => ({
                ...current,
                [show.id]: { throughEpisodeId: null, show: full },
              }));
            } catch (requestError) {
              setSearchError(requestError);
            } finally {
              setSearching(false);
            }
          }}
          onProgress={(showId, throughEpisodeId) => {
            setSelectedShows((current) => ({
              ...current,
              [showId]: { ...current[showId], throughEpisodeId },
            }));
          }}
          onBack={() => setStep(1)}
          onSkip={() => {
            setSelectedShows({});
            setQuery('');
            setResults([]);
            setStep(3);
          }}
          onContinue={() => {
            setQuery('');
            setResults([]);
            setStep(3);
          }}
        />
      ) : null}
      {step === 3 ? (
        <MovieStep
          query={query}
          onQuery={(text) => {
            setQuery(text);
            if (text.trim().length < 2) {
              setResults([]);
            }
          }}
          results={results}
          searching={searching}
          searchError={searchError}
          configured={config.ready}
          selected={selectedMovies}
          onToggle={(movie) => {
            setSelectedMovies((current) => {
              const next = { ...current };
              if (next[movie.id]) {
                delete next[movie.id];
              } else {
                rememberMovie(movie);
                next[movie.id] = movie;
              }
              return next;
            });
          }}
          onBack={() => setStep(2)}
          onSkip={() => finish([])}
          onFinish={() => finish(Object.keys(selectedMovies))}
        />
      ) : null}
    </SafeAreaView>
  );
}

function WelcomeStep({ onStart, onDemo }) {
  const { t } = useTranslation();
  return (
    <View style={styles.welcome}>
      <Text style={styles.brand}>{t('common.appName')}</Text>
      <Text style={styles.welcomeTitle}>{t('onboarding.welcomeTitle')}</Text>
      <Text style={styles.welcomeBody}>{t('onboarding.welcomeBody')}</Text>
      <PrimaryButton label={t('onboarding.getStarted')} onPress={onStart} />
      <PrimaryButton label={t('onboarding.tryDemo')} onPress={onDemo} variant="secondary" />
      <Text style={styles.hint}>{t('onboarding.tryDemoHint')}</Text>
    </View>
  );
}

function ShowStep({ query, onQuery, results, searching, searchError, configured, selected, onToggle, onProgress, onBack, onSkip, onContinue }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const size = posterSize(width);
  const filtered = results;
  const chosen = Object.values(selected).map((value) => value.show).filter(Boolean);

  return (
    <View style={styles.step}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        style={styles.flex}
        columnWrapperStyle={filtered.length ? { gap: size.gap, paddingHorizontal: spacing.md, marginBottom: size.gap } : undefined}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={
          <View>
            <Text style={styles.hero}>{t('onboarding.showsTitle')}</Text>
            <Text style={styles.body}>{t('onboarding.showsBody')}</Text>
            <SearchField value={query} onChangeText={onQuery} placeholder={t('onboarding.searchShows')} />
            {searching ? <Text style={styles.empty}>{t('trakt.loading')}</Text> : null}
            {searchError ? <Text style={styles.empty}>{t(`trakt.errors.${searchError.code || 'unknown'}`)}</Text> : null}
            {!configured ? <Text style={styles.empty}>{t('trakt.notConfigured')}</Text> : null}
          </View>
        }
        ListEmptyComponent={query.trim().length < 2 ? <Text style={styles.empty}>{t('onboarding.searchPrompt')}</Text> : <Text style={styles.empty}>{t('onboarding.emptySearch')}</Text>}
        ListFooterComponent={
          chosen.length ? (
            <View style={styles.footerBlock}>
              <Text style={styles.section}>{t('onboarding.progressTitle')}</Text>
              {chosen.map((show) => (
                <ProgressPicker
                  key={show.id}
                  show={show}
                  throughEpisodeId={selected[show.id]?.throughEpisodeId || null}
                  onChange={(episodeId) => onProgress(show.id, episodeId)}
                />
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const active = Boolean(selected[item.id]);
          return (
            <PosterTile
              posterPath={item.posterPath}
              title={item.title}
              width={size.width}
              height={size.height}
              selected={active}
              selectable
              onPress={() => onToggle(item)}
              accessibilityState={{ checked: active }}
              accessibilityLabel={item.title}
            />
          );
        }}
      />
      <Text style={styles.count}>{t('onboarding.selected', { count: chosen.length })}</Text>
      <StepActions
        backLabel={t('common.back')}
        onBack={onBack}
        skipLabel={t('onboarding.skip')}
        onSkip={onSkip}
        nextLabel={t('onboarding.continue')}
        onNext={onContinue}
      />
    </View>
  );
}

function ProgressPicker({ show, throughEpisodeId, onChange }) {
  const { t } = useTranslation();
  const released = releasedEpisodes(show);

  return (
    <View style={styles.progressCard}>
      <Text style={styles.choiceTitle}>{mediaTitle(t, show)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip
          label={t('onboarding.notStarted')}
          selected={!throughEpisodeId}
          onPress={() => onChange(null)}
        />
        {released.map((episode) => {
          const code = t('common.episodeCode', episodeCode(episode));
          return (
            <Chip
              key={episode.id}
              label={code}
              selected={throughEpisodeId === episode.id}
              onPress={() => onChange(episode.id)}
              accessibilityLabel={t('onboarding.watchedThrough', { code, title: episodeTitle(t, episode) })}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function Chip({ label, selected, onPress, accessibilityLabel }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function MovieStep({ query, onQuery, results, searching, searchError, configured, selected, onToggle, onBack, onSkip, onFinish }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const size = posterSize(width);
  const filtered = results;
  const count = Object.keys(selected).length;

  return (
    <View style={styles.step}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        numColumns={2}
        style={styles.flex}
        columnWrapperStyle={filtered.length ? { gap: size.gap, paddingHorizontal: spacing.md, marginBottom: size.gap } : undefined}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={
          <View>
            <Text style={styles.hero}>{t('onboarding.moviesTitle')}</Text>
            <Text style={styles.body}>{t('onboarding.moviesBody')}</Text>
            <SearchField value={query} onChangeText={onQuery} placeholder={t('onboarding.searchMovies')} />
            {searching ? <Text style={styles.empty}>{t('trakt.loading')}</Text> : null}
            {searchError ? <Text style={styles.empty}>{t(`trakt.errors.${searchError.code || 'unknown'}`)}</Text> : null}
            {!configured ? <Text style={styles.empty}>{t('trakt.notConfigured')}</Text> : null}
          </View>
        }
        ListEmptyComponent={query.trim().length < 2 ? <Text style={styles.empty}>{t('onboarding.searchPrompt')}</Text> : <Text style={styles.empty}>{t('onboarding.emptySearch')}</Text>}
        renderItem={({ item }) => {
          const active = Boolean(selected[item.id]);
          return (
            <PosterTile
              uri={item.poster}
              posterPath={item.posterPath}
              title={item.title}
              meta={item.year ? String(item.year) : null}
              width={size.width}
              height={size.height}
              selected={active}
              selectable
              onPress={() => onToggle(item)}
              accessibilityState={{ checked: active }}
              accessibilityLabel={item.title}
            />
          );
        }}
      />
      <Text style={styles.count}>{t('onboarding.selected', { count })}</Text>
      <StepActions
        backLabel={t('common.back')}
        onBack={onBack}
        skipLabel={t('onboarding.skip')}
        onSkip={onSkip}
        nextLabel={t('onboarding.finish')}
        onNext={onFinish}
      />
    </View>
  );
}

function StepActions({ backLabel, onBack, skipLabel, onSkip, nextLabel, onNext }) {
  return (
    <View style={styles.actions}>
      <PrimaryButton label={backLabel} onPress={onBack} variant="secondary" style={styles.action} />
      <PrimaryButton label={skipLabel} onPress={onSkip} variant="secondary" style={styles.action} />
      <PrimaryButton label={nextLabel} onPress={onNext} style={styles.action} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 22,
    backgroundColor: colors.primary,
  },
  welcome: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  step: {
    flex: 1,
    paddingTop: spacing.md,
  },
  flex: {
    flex: 1,
  },
  welcomeTitle: {
    ...typography.hero,
    color: colors.text,
  },
  welcomeBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  brand: {
    ...typography.label,
    color: colors.primary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  hero: {
    ...typography.hero,
    color: colors.text,
    paddingHorizontal: spacing.lg,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  grid: {
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  choiceTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  section: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.sm,
  },
  footerBlock: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  progressCard: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.label,
    color: colors.text,
  },
  chipTextSelected: {
    color: colors.onPrimary,
  },
  count: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
