/** Default ladder fractions for capacity probes (finer than stress's 25/50/75/100 when customized). */
export const DEFAULT_CAPACITY_FRACTIONS = [0.25, 0.5, 0.75, 1]

/**
 * Unique ascending VU targets for a capacity / stress ladder.
 * @param {number} maxPairs
 * @param {number[]} [fractions]
 * @returns {number[]}
 */
export function capacityLadderTargets(maxPairs, fractions) {
  const fracs =
    fractions && fractions.length ? fractions : DEFAULT_CAPACITY_FRACTIONS
  const steps = fracs.map(function (fraction) {
    return Math.max(1, Math.round(maxPairs * fraction))
  })
  const unique = []
  for (let i = 0; i < steps.length; i++) {
    if (unique.indexOf(steps[i]) === -1) unique.push(steps[i])
  }
  return unique
}

/**
 * k6 ramping-vus stages: ramp+hold per target, longer peak hold, cool-down to 0.
 * @param {number[]} targets
 * @param {{ rampS: number, holdS: number, peakHoldS: number }} opts
 */
export function buildLadderStages(targets, opts) {
  const rampS = opts.rampS
  const holdS = opts.holdS
  const peakHoldS = opts.peakHoldS
  const stages = []
  for (let i = 0; i < targets.length; i++) {
    const hold = i === targets.length - 1 ? peakHoldS : holdS
    stages.push({ duration: rampS + "s", target: targets[i] })
    stages.push({ duration: hold + "s", target: targets[i] })
  }
  stages.push({ duration: rampS + "s", target: 0 })
  return stages
}

/**
 * Stable REST mix rows (sorted by name) with shares summing to 1.
 * @param {Record<string, number>} countsByTag
 * @returns {{ name: string, count: number, share: number }[]}
 */
export function restMixShares(countsByTag) {
  const names = Object.keys(countsByTag || {}).sort()
  let total = 0
  for (let i = 0; i < names.length; i++) {
    const n = Number(countsByTag[names[i]]) || 0
    if (n > 0) total += n
  }
  if (total <= 0) return []

  const rows = []
  for (let i = 0; i < names.length; i++) {
    const count = Number(countsByTag[names[i]]) || 0
    if (count <= 0) continue
    rows.push({ name: names[i], count: count, share: count / total })
  }
  return rows
}
