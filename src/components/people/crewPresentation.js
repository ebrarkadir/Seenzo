export const KEY_CREW_LIMIT = 4;
export const DEPT_ACCORDION_THRESHOLD = 12;

function jobMatch(person, needles) {
  const jobs = (person?.jobs || []).map((job) => String(job).toLowerCase());
  return needles.some((needle) => jobs.some((job) => job.includes(needle)));
}

const PRIORITY_MATCHERS = [
  (person, department) => department === 'created by' || jobMatch(person, ['creator', 'created by']),
  (person, department) => department === 'directing' || jobMatch(person, ['director']),
  (person, department) => department === 'writing' || jobMatch(person, ['writer', 'screenplay', 'teleplay']),
  (person, department) => jobMatch(person, ['executive producer']),
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

  PRIORITY_MATCHERS.forEach((matcher) => {
    if (selected.length >= limit) {
      return;
    }
    const match = entries.find(({ department, person }) => {
      if (seen.has(person.personId)) {
        return false;
      }
      return matcher(person, department);
    });
    if (match) {
      seen.add(match.person.personId);
      selected.push(match);
    }
  });

  if (selected.length < limit) {
    entries.forEach((entry) => {
      if (selected.length >= limit || seen.has(entry.person.personId)) {
        return;
      }
      seen.add(entry.person.personId);
      selected.push(entry);
    });
  }

  return selected;
}

export function shouldAccordionDepartments(people) {
  return countCrewMembers(people) >= DEPT_ACCORDION_THRESHOLD;
}
