export function calculateWaiverScore(player, weights, context) {
  const utilizationScore = player.routes > 0 ? player.tprr * 100 : 0;
  const opportunityScore = (player.targets + player.redZoneTargets * 2) * 2;
  const efficiencyScore = (player.airYards / (player.routes || 1)) * 5;
  const matchupScore = context.vegasImpliedPoints?.[player.team] ?? 0;
  const projectionScore = player.projectedPoints ?? 0;

  const finalScore =
    utilizationScore * weights.utilization +
    opportunityScore * weights.opportunity +
    efficiencyScore * weights.efficiency +
    matchupScore * weights.matchup +
    projectionScore * weights.projection;

  return Math.round(finalScore * 100) / 100;
}
