import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { fetchEpisodePeople, fetchMoviePeople, fetchShowPeople } from '../../services/trakt/people';
import { colors, radii, spacing, typography } from '../../theme';
import PrimaryButton from '../ui/PrimaryButton';
import {
  CAST_PREVIEW_COUNT,
  countCrewMembers,
  KEY_CREW_LIMIT,
  MOVIE_CAST_PREVIEW_COUNT,
  MOVIE_KEY_CREW_LIMIT,
  pickKeyCrewMembers,
  shouldAccordionDepartments,
} from './crewPresentation';
import PersonAvatar from './PersonAvatar';

export default function CastCrewSection(props) {
  const [attempt, setAttempt] = useState(0);
  const mediaId = props.mode === 'movie' ? props.traktMovieId : props.traktShowId;
  return (
    <CastCrewSectionBody
      key={`${props.mode}-${mediaId}-${props.seasonNumber ?? 'x'}-${props.episodeNumber ?? 'x'}-${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function CastCrewSectionBody({
  mode,
  traktShowId,
  traktMovieId,
  seasonNumber,
  episodeNumber,
  compact = false,
  parts = 'all',
  people: peopleProp = null,
  onRetry,
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const hasPeopleProp = peopleProp != null;
  const [fetchedPeople, setFetchedPeople] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!hasPeopleProp);
  const [castModalOpen, setCastModalOpen] = useState(false);
  const showCast = parts === 'all' || parts === 'cast';
  const showCrew = parts === 'all' || parts === 'crew';

  useEffect(() => {
    if (hasPeopleProp) {
      return undefined;
    }
    let active = true;
    const load = async () => {
      if (mode === 'movie') {
        return fetchMoviePeople(traktMovieId);
      }
      // Episode mode stays episode-scoped: never fall back to show-wide people.
      if (mode === 'episode') {
        return fetchEpisodePeople(traktShowId, seasonNumber, episodeNumber);
      }
      return fetchShowPeople(traktShowId);
    };
    load()
      .then((data) => {
        if (!active) {
          return;
        }
        setFetchedPeople(data);
        setError(null);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        setFetchedPeople(null);
        setError(requestError);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [episodeNumber, hasPeopleProp, mode, seasonNumber, traktMovieId, traktShowId]);

  if (!hasPeopleProp && loading) {
    return <Text style={styles.meta}>{t('people.loading')}</Text>;
  }

  if (!hasPeopleProp && error) {
    return (
      <View style={styles.block}>
        <Text style={styles.meta}>{t('people.error')}</Text>
        <PrimaryButton label={t('people.retry')} variant="secondary" onPress={onRetry} />
      </View>
    );
  }

  const people = hasPeopleProp ? peopleProp : fetchedPeople;
  const cast = people?.cast || [];
  const guests = people?.guestStars || [];
  const departments = people?.departments || [];
  const castPreviewCount = mode === 'movie' ? MOVIE_CAST_PREVIEW_COUNT : CAST_PREVIEW_COUNT;
  const needsSeeAll = cast.length > castPreviewCount;
  const visibleCast = needsSeeAll ? cast.slice(0, castPreviewCount) : cast;
  const emptyCast = !cast.length && !guests.length;
  const emptyCrew = !departments.length;
  const empty = (showCast ? emptyCast : true) && (showCrew ? emptyCrew : true);
  const collapsibleCrew = mode === 'show' || mode === 'movie';
  const crewPreviewLimit = mode === 'movie' ? MOVIE_KEY_CREW_LIMIT : KEY_CREW_LIMIT;
  const cardWidthStyle = compact ? styles.cardCompact : null;

  if (empty) {
    return parts === 'all' ? <Text style={styles.meta}>{t('people.empty')}</Text> : null;
  }

  return (
    <View style={styles.block}>
      {showCast && cast.length ? (
        <View style={styles.group}>
          <Text style={styles.heading}>{t('people.cast')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {visibleCast.map((person) => (
              <CastPersonCard
                key={`cast-${person.personId}`}
                person={person}
                compact={compact}
                unknownRole={t('people.unknownRole')}
                episodeCountLabel={
                  person.episodeCount != null
                    ? t('people.episodeCount', { count: person.episodeCount })
                    : null
                }
              />
            ))}
            {needsSeeAll ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('people.seeAllCastA11y', { count: cast.length })}
                onPress={() => setCastModalOpen(true)}
                style={[styles.seeAllCard, cardWidthStyle]}
              >
                <View style={styles.seeAllIconWrap}>
                  <Ionicons name="people-outline" size={compact ? 22 : 26} color={colors.primary} />
                </View>
                <Text style={styles.seeAllLabel}>{t('people.seeAllCast')}</Text>
                <Text style={styles.seeAllCount}>{t('people.seeAllCastCount', { count: cast.length })}</Text>
                <Ionicons name="arrow-forward" size={16} color={colors.primary} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {showCast && guests.length ? (
        <View style={styles.group}>
          <Text style={styles.heading}>{t('people.guestStars')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {guests.map((person) => (
              <CastPersonCard
                key={`guest-${person.personId}`}
                person={person}
                compact={compact}
                unknownRole={t('people.unknownRole')}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {showCrew && departments.length ? (
        collapsibleCrew ? (
          <CollapsibleCrewSection
            people={people}
            heading={t('people.crew')}
            previewLimit={crewPreviewLimit}
          />
        ) : (
          <View style={styles.group}>
            <Text style={styles.heading}>{t('people.crew')}</Text>
            {departments.map((department) => (
              <View key={department} style={styles.crewDepartment}>
                <Text style={styles.department}>{department}</Text>
                {(people.crewByDepartment[department] || []).map((person) => (
                  <CrewMemberRow
                    key={`${department}-${person.personId}-${person.jobs.join('-')}`}
                    person={person}
                    unknownRole={t('people.unknownRole')}
                  />
                ))}
              </View>
            ))}
          </View>
        )
      ) : null}

      <Modal
        visible={castModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCastModalOpen(false)}
      >
        <View style={[styles.modalScreen, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('people.allCastTitle')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('people.closeCastList')}
              onPress={() => setCastModalOpen(false)}
              style={styles.modalClose}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.modalMeta}>{t('people.allCastCount', { count: cast.length })}</Text>
          <ScrollView
            contentContainerStyle={[
              styles.modalList,
              { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            ]}
          >
            {cast.map((person, index) => (
              <View key={`modal-cast-${person.personId}`} style={styles.modalRow}>
                <Text style={styles.modalRank}>{index + 1}</Text>
                <PersonAvatar headshotPath={person.headshotPath} size={52} />
                <View style={styles.modalCopy}>
                  <Text style={styles.name} numberOfLines={1}>{person.name}</Text>
                  <Text style={styles.role} numberOfLines={2}>
                    {person.characters.join(', ') || t('people.unknownRole')}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function CastPersonCard({ person, compact, unknownRole, episodeCountLabel = null }) {
  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <PersonAvatar headshotPath={person.headshotPath} size={compact ? 56 : 72} />
      <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
      <Text style={styles.role} numberOfLines={2}>
        {person.characters.join(', ') || unknownRole}
      </Text>
      {episodeCountLabel ? <Text style={styles.meta}>{episodeCountLabel}</Text> : null}
    </View>
  );
}

function CollapsibleCrewSection({ people, heading, previewLimit = KEY_CREW_LIMIT }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [openDepartments, setOpenDepartments] = useState(() => new Set());
  const keyMembers = pickKeyCrewMembers(people, previewLimit);
  const totalCrew = countCrewMembers(people);
  const remaining = Math.max(totalCrew - keyMembers.length, 0);
  const useAccordion = shouldAccordionDepartments(people);
  const departments = people?.departments || [];

  const toggleDepartment = (department) => {
    setOpenDepartments((current) => {
      const next = new Set(current);
      if (next.has(department)) {
        next.delete(department);
      } else {
        next.add(department);
      }
      return next;
    });
  };

  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{heading}</Text>
      {!expanded ? (
        <View style={styles.crewPreview}>
          {keyMembers.map(({ department, person }) => (
            <CrewMemberRow
              key={`key-${department}-${person.personId}-${person.jobs.join('-')}`}
              person={person}
              unknownRole={t('people.unknownRole')}
            />
          ))}
          {remaining > 0 ? (
            <Text style={styles.meta}>{t('people.moreCrewCount', { count: remaining })}</Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.crewExpanded}>
          {departments.map((department) => {
            const members = people.crewByDepartment[department] || [];
            const isOpen = !useAccordion || openDepartments.has(department);
            return (
              <View key={department} style={styles.crewDepartment}>
                {useAccordion ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => toggleDepartment(department)}
                    style={styles.departmentHeader}
                  >
                    <Text style={styles.department}>
                      {t('people.departmentCount', {
                        department,
                        count: members.length,
                      })}
                    </Text>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                ) : (
                  <Text style={styles.department}>
                    {t('people.departmentCount', {
                      department,
                      count: members.length,
                    })}
                  </Text>
                )}
                {isOpen
                  ? members.map((person) => (
                    <CrewMemberRow
                      key={`${department}-${person.personId}-${person.jobs.join('-')}`}
                      person={person}
                      unknownRole={t('people.unknownRole')}
                    />
                  ))
                  : null}
              </View>
            );
          })}
        </View>
      )}
      {totalCrew > keyMembers.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setExpanded((value) => !value);
            if (expanded) {
              setOpenDepartments(new Set());
            }
          }}
          style={styles.toggleRow}
        >
          <Text style={styles.link}>
            {expanded ? t('people.showLessCrew') : t('people.showMoreCrew')}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.primary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function CrewMemberRow({ person, unknownRole }) {
  return (
    <View style={styles.crewRow}>
      <View style={styles.crewCopy}>
        <Text style={styles.crewName} numberOfLines={1}>{person.name}</Text>
        <Text style={styles.role} numberOfLines={1}>
          {person.jobs.join(', ') || unknownRole}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  group: {
    gap: spacing.sm,
  },
  heading: {
    ...typography.subtitle,
    color: colors.text,
  },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'stretch',
  },
  card: {
    width: 108,
    gap: 6,
  },
  cardCompact: {
    width: 96,
  },
  seeAllCard: {
    width: 108,
    minHeight: 148,
    gap: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seeAllIconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seeAllLabel: {
    ...typography.label,
    color: colors.text,
    textAlign: 'center',
  },
  seeAllCount: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  name: {
    ...typography.label,
    color: colors.text,
  },
  crewName: {
    ...typography.label,
    color: colors.text,
  },
  role: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  link: {
    ...typography.label,
    color: colors.primary,
  },
  crewPreview: {
    gap: 6,
  },
  crewExpanded: {
    gap: spacing.xs,
  },
  crewDepartment: {
    gap: 4,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  departmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  department: {
    ...typography.label,
    color: colors.primary,
    textTransform: 'capitalize',
    flex: 1,
  },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  crewCopy: {
    flex: 1,
    gap: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  modalTitle: {
    ...typography.title,
    color: colors.text,
    flex: 1,
  },
  modalClose: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  modalList: {
    gap: spacing.sm,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalRank: {
    ...typography.label,
    color: colors.primary,
    width: 24,
    textAlign: 'center',
  },
  modalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});
