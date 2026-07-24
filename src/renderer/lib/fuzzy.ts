/**
 * Lightweight fuzzy matcher for slash menus and client-side ranking.
 * Higher score = better match; 0 = no match.
 */
export function fuzzyScore(query: string, ...fields: string[]): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  let best = 0
  for (const field of fields) {
    const sc = scoreOne(q, (field || '').toLowerCase())
    if (sc > best) best = sc
  }
  return best
}

function scoreOne(q: string, t: string): number {
  if (!t) return 0
  if (t === q) return 10_000
  if (t.startsWith(q)) return 5_000 + Math.max(0, 100 - t.length)
  if (t.includes(q)) return 2_000 + Math.max(0, 80 - t.indexOf(q))

  // word / segment starts
  const segs = t.split(/[\s/_\-.:]+/).filter(Boolean)
  for (const s of segs) {
    if (s.startsWith(q)) return 3_200
    if (s.includes(q)) return 1_200
  }

  // subsequence
  let qi = 0
  let score = 0
  let consecutive = 0
  let last = -2
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      consecutive = i === last + 1 ? consecutive + 1 : 1
      score += 8 + consecutive * 5
      if (i === 0 || /[\s/_\-.:]/.test(t[i - 1])) score += 14
      last = i
      qi++
    }
  }
  if (qi < q.length) return 0
  return score + Math.max(0, 30 - t.length)
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getFields: (item: T) => string[],
  limit = 40,
): T[] {
  const ranked = items
    .map((item) => ({ item, sc: fuzzyScore(query, ...getFields(item)) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
  return ranked.slice(0, limit).map((x) => x.item)
}
