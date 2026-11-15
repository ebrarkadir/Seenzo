export const KEY_CREW_LIMIT = 6;
export const DEPT_ACCORDION_THRESHOLD = 12;

function normalizedJobs(person) {
  return (person?.jobs || []).map((job) => String(job || '').toLowerCase().trim()).filter(Boolean);
}

function hasExactJob(person, titles) {
  const jobs = normalizedJobs(person);
  return titles.some((title) => jobs.includes(title));
}

function hasWriterJob(person) {
  if (hasExactJob(person, ['writer', 'screenplay', 'teleplay'])) {
    return true;
  }
  return normalizedJobs(person).some((job) => {
    if (job === 'novel' || job.includes('novel')) {
      return false;
    }
    return job.includes('writer');
  });
}

function hasProducerJob(person) {
  return hasExactJob(person, [
    'executive producer',
    'co-executive producer',
    'producer',
    'co-producer',
    'associate producer',
  ]);
}

function isDirector(person) {
  // Exact "Director" only — never Assistant Director / Second Unit Director, etc.
  return hasExactJob(person, ['director']);
}

function isCreator(person, department) {
  return department === 'created by' || hasExactJob(person, ['creator', 'created by']);
}

/** Priority tiers for collapsed crew preview. Director first when real directing credits exist. */
export const CREW_PRIORITY_TIERS = [
  {
    key: 'director',
    takeAll: true,
    match: ({ person }) => isDirector(person),
  },
  {
    key: 'writer',
    takeAll: false,
    match: ({ person }) => hasWriterJob(person),
  },
  {
    key: 'creator',
    takeAll: false,
    match: ({ person, department }) => isCreator(person, department),
  },
  {
    key: 'producer',
    takeAll: false,
    match: ({ person }) => hasProducerJob(person),
  },
];

export function flattenCrewEntries(people) {
  const departments = people?.departments || [];
  const byDepartment = people?.crewByDepartment || {};
  const entries = [];
  departments.forEach((department) => {
    (byDepartment[department] || []).forEach((person) => {
      entries.push({ department, person });
    });
  });
  return entries;
}

export function countCrewMembers(people) {
  return flattenCrewEntries(people).length;
}

export function pickKeyCrewMembers(people, limit = KEY_CREW_LIMIT) {
  const entries = flattenCrewEntries(people);
  const selected = [];
  const seen = new Set();

  const push = (entry) => {
    if (!entry?.person?.personId) {
      return false;
    }
    if (seen.has(entry.person.personId)) {
      // Same person can hold Director + Writer (etc.); merge jobs for display.
      const existing = selected.find((item) => item.person.personId === entry.person.personId);
      if (existing) {
        const jobs = [...(existing.person.jobs || [])];
        (entry.person.jobs || []).forEach((job) => {
          if (!jobs.includes(job)) {
            jobs.push(job);
          }
        });
        existing.person = { ...existing.person, jobs };
      }
      return false;
    }
    seen.add(entry.person.personId);
    selected.push({
      department: entry.department,
      person: {
        ...entry.person,
        jobs: [...(entry.person.jobs || [])],
      },
    });
    return true;
  };

  CREW_PRIORITY_TIERS.forEach((tier) => {
    if (!tier.takeAll && selected.length >= limit) {
      return;
    }
    entries.forEach((entry) => {
      if (!tier.takeAll && selected.length >= limit) {
        return;
      }
      if (!tier.match(entry)) {
        return;
      }
      push(entry);
    });
  });

  if (selected.length < limit) {
    // Fill remaining slots without promoting Assistant/Second Unit directors.
    // Prefer leftover writing / creator / production credits over other departments.
    const fillOrder = ['writing', 'created by', 'production'];
    const remaining = entries.filter((entry) => {
      if (seen.has(entry.person.personId)) {
        return false;
      }
      if (entry.department === 'directing' && !isDirector(entry.person)) {
        return false;
      }
      return true;
    });
    remaining
      .slice()
      .sort((left, right) => {
        const leftIndex = fillOrder.indexOf(left.department);
        const rightIndex = fillOrder.indexOf(right.department);
        const leftRank = leftIndex === -1 ? fillOrder.length : leftIndex;
        const rightRank = rightIndex === -1 ? fillOrder.length : rightIndex;
        return leftRank - rightRank;
      })
      .forEach((entry) => {
        if (selected.length >= limit) {
          return;
        }
        push(entry);
      });
  }

  return selected;
}

export function shouldAccordionDepartments(people) {
  return countCrewMembers(people) >= DEPT_ACCORDION_THRESHOLD;
}
