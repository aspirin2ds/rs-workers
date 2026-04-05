export function resolveNextStoryTime(input: {
  storyTime: number;
  proposedNextAt?: number | null;
  minDelaySeconds: number;
  maxDelaySeconds: number;
}): number {
  const earliest = input.storyTime + input.minDelaySeconds * 1000;
  const latest = input.storyTime + input.maxDelaySeconds * 1000;
  const fallback = earliest;
  const proposed = input.proposedNextAt ?? fallback;
  return Math.min(latest, Math.max(earliest, proposed));
}
