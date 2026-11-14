import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { fetchEpisodePeople, fetchShowPeople } from '../../services/trakt/people';
import { colors, spacing, typography } from '../../theme';
import PrimaryButton from '../ui/PrimaryButton';
import {
  countCrewMembers,
  pickKeyCrewMembers,
  shouldAccordionDepartments,
} from './crewPresentation';
import PersonAvatar from './PersonAvatar';

const PREVIEW_COUNT = 12;

export default function CastCrewSection(props) {
  const [attempt, setAttempt] = useState(0);
  return (
    <CastCrewSectionBody
      key={`${props.mode}-${props.traktShowId}-${props.seasonNumber ?? 'x'}-${props.episodeNumber ?? 'x'}-${attempt}`}
      {...props}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function CastCrewSectionBody({
  mode,
  traktShowId,
  seasonNumber,
  episodeNumber,
  compact = false,
  onRetry,
}) {
  const { t } = useTranslation();
  const [people, setPeople] = useState(null);
  const [source, setSource] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllCast, setShowAllCast] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (mode !== 'episode') {
        return { data: await fetchShowPeople(traktShowId), source: 'show' };
      }
      const episodePeople = await fetchEpisodePeople(traktShowId, seasonNumber, episodeNumber);
      return { data: episodePeople, source: 'episode' };
    };
    load()
      .then((result) => {
        if (!active) {
          return;
        }
        setPeople(result.data);
        setSource(result.source);
        setError(null);
        setLoading(false);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }
        setPeople(null);
        setSource(null);
        setError(requestError);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [episodeNumber, mode, seasonNumber, traktShowId]);

  if (loading) {
    return <Text style={styles.meta}>{t('people.loading')}</Text>;
  }

  if (error) {
    return (
      <View style={styles.block}>
        <Text style={styles.meta}>{t('people.error')}</Text>
        <PrimaryButton label={t('people.retry')} variant="secondary" onPress={onRetry} />
      </View>
    );
  }

  const cast = people?.cast || [];
  const guests = people?.guestStars || [];
  const departments = people?.departments || [];
  const visibleCast = showAllCast ? cast : cast.slice(0, PREVIEW_COUNT);
  const empty = !cast.length && !guests.length && !departments.length;
  const collapsibleCrew = mode === 'show';

  if (empty) {
    return <Text style={styles.meta}>{t('people.empty')}</Text>;
  }

  return (
    <View style={styles.block}>
      {source === 'show-fallback' ? (
        <Text style={styles.meta}>{t('people.showFallbackNote')}</Text>
      ) : null}
      {cast.length ? (
        <View style={styles.group}>
          <Text style={styles.heading}>
            {source === 'show-fallback' ? t('people.showCastFallback') : t('people.cast')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {visibleCast.map((person) => (
              <View key={`cast-${person.personId}`} style={[styles.card, compact && styles.cardCompact]}>
                <PersonAvatar headshotPath={person.headshotPath} size={compact ? 56 : 72} />
                <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
                <Text style={styles.role} numberOfLines={2}>
                  {person.characters.join(', ') || t('people.unknownRole')}
                </Text>
                {person.episodeCount != null ? (
                  <Text style={styles.meta}>{t('people.episodeCount', { count: person.episodeCount })}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
          {cast.length > PREVIEW_COUNT ? (
            <Pressable accessibilityRole="button" onPress={() => setShowAllCast((value) => !value)}>
              <Text style={styles.link}>
                {showAllCast ? t('people.showLess') : t('people.showAllCast', { count: cast.length })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {guests.length ? (
        <View style={styles.group}>
          <Text style={styles.heading}>{t('people.guestStars')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {guests.map((person) => (
              <View key={`guest-${person.personId}`} style={[styles.card, compact && styles.cardCompact]}>
                <PersonAvatar headshotPath={person.headshotPath} size={compact ? 56 : 72} />
                <Text style={styles.name} numberOfLines={2}>{person.name}</Text>
                <Text style={styles.role} numberOfLines={2}>
                  {person.characters.join(', ') || t('people.unknownRole')}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {departments.length ? (
        collapsibleCrew ? (
          <CollapsibleCrewSection
            people={people}
            heading={source === 'show-fallback' ? t('people.showCrewFallback') : t('people.crew')}
          />
        ) : (
          <View style={styles.group}>
            <Text style={styles.heading}>
              {source === 'show-fallback' ? t('people.showCrewFallback') : t('people.crew')}
            </Text>
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
    </View>
  );
}

function CollapsibleCrewSection({ people, heading }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [openDepartments, setOpenDepartments] = useState(() => new Set());
  const keyMembers = pickKeyCrewMembers(people);
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
  },
  card: {
    width: 108,
    gap: 6,
  },
  cardCompact: {
    width: 96,
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
});
