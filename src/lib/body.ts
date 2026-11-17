// US Navy body-fat estimate (male, metric): needs waist at the navel, neck below the larynx, and height, all in cm.
// Typically within about ±3–4% of a DEXA scan; most useful as a trend with the same tape, same spot, same time of day.
export function navyBf(waist?: number | null, neck?: number | null, height?: number | null) {
  if (!waist || !neck || !height || waist <= neck) return null
  const bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450
  return Math.round(bf * 10) / 10
}

/** fat and lean mass from weight and body-fat % */
export const split = (kg?: number | null, bf?: number | null) => (kg && bf != null ? { fat: Math.round(kg * bf) / 100, lean: Math.round(kg * (100 - bf)) / 100 } : null)
