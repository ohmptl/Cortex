import type { Course } from "@/types/course";

// Average of (score/total) across graded items in a category, as a percentage.
export function calculateCategoryGrade(course: Course, category: string): number | null {
  const items = course.gradedItems.filter((i) => i.category === category);
  if (items.length === 0) return null;

  const total = items.reduce((acc, item) => acc + item.score / item.total, 0);
  return (total / items.length) * 100;
}

// Weighted overall grade across all categories that have at least one graded item.
// Returns null if there are no grade weights defined or nothing has been graded yet.
export function calculateOverallGrade(course: Course): number | null {
  if (!course.gradeWeights || course.gradeWeights.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const gw of course.gradeWeights) {
    const categoryGrade = calculateCategoryGrade(course, gw.category);
    if (categoryGrade !== null) {
      weightedSum += categoryGrade * (gw.weight / 100);
      totalWeight += gw.weight;
    }
  }

  if (totalWeight === 0) return null;
  return weightedSum / (totalWeight / 100);
}
