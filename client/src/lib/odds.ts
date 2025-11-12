export async function fetchVegasImpliedTotal(teamAbbrev: string): Promise<number | null> {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const data = await res.json();

    const game = data.events.find((g: any) =>
      g.competitions[0].competitors.some(
        (c: any) => c.team.abbreviation.toUpperCase() === teamAbbrev.toUpperCase()
      )
    );

    if (!game) return null;

    const comp = game.competitions[0];
    const home = comp.competitors.find((c: any) => c.homeAway === 'home');
    const away = comp.competitors.find((c: any) => c.homeAway === 'away');

    const odds = comp.odds?.[0];
    if (!odds) return null;

    const total = odds.overUnder || 45;
    const homeSpread = parseFloat(odds.details || '0');

    const isHome = home.team.abbreviation.toUpperCase() === teamAbbrev.toUpperCase();
    const spread = isNaN(homeSpread) ? 0 : homeSpread;

    const impliedHome = total / 2 - spread / 2;
    const impliedAway = total / 2 + spread / 2;

    return isHome ? impliedHome : impliedAway;
  } catch (err) {
    console.error('Implied total fetch error:', err);
    return null;
  }
}
