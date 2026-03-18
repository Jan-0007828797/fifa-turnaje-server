
const { PRIZE_PERCENTAGES, TOP_SCORER_PERCENT, TOP_DEFENSE_PERCENT } = require('./constants');

function makeBlank(player) {
  return {
    playerId: player.id,
    slot: player.slot,
    name: player.name,
    played: 0,
    winsRegular: 0,
    winsOT: 0,
    lossesOT: 0,
    lossesRegular: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    auctionCost: 0,
    buyIn: 0,
    totalCosts: 0,
    prize: 0,
    topScorerPrize: 0,
    topDefensePrize: 0,
    revenue: 0,
    net: 0,
    sharedPosition: false,
    position: null
  };
}

function compareStats(a, b) {
  return (
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.goalsFor - a.goalsFor ||
    a.name.localeCompare(b.name, 'cs')
  );
}

function sameRank(a, b) {
  return a.points === b.points && a.goalDiff === b.goalDiff && a.goalsFor === b.goalsFor;
}

function calculateTournament(tournament) {
  const rows = Object.fromEntries(tournament.players.map((p) => [p.id, makeBlank(p)]));
  tournament.players.forEach((p) => {
    rows[p.id].buyIn = tournament.buyIn;
    rows[p.id].totalCosts += tournament.buyIn;
  });

  for (const match of tournament.matches.sort((a, b) => a.order - b.order)) {
    if (match.scoreA == null || match.scoreB == null) continue;

    const teamA = [match.teamAPlayer1Id, match.teamAPlayer2Id];
    const teamB = [match.teamBPlayer1Id, match.teamBPlayer2Id];

    for (const id of teamA) {
      rows[id].played += 1;
      rows[id].goalsFor += match.scoreA;
      rows[id].goalsAgainst += match.scoreB;
      rows[id].goalDiff = rows[id].goalsFor - rows[id].goalsAgainst;
      rows[id].auctionCost += match.auctionA || 0;
      rows[id].totalCosts += match.auctionA || 0;
    }
    for (const id of teamB) {
      rows[id].played += 1;
      rows[id].goalsFor += match.scoreB;
      rows[id].goalsAgainst += match.scoreA;
      rows[id].goalDiff = rows[id].goalsFor - rows[id].goalsAgainst;
      rows[id].auctionCost += match.auctionB || 0;
      rows[id].totalCosts += match.auctionB || 0;
    }

    if (match.scoreA > match.scoreB) {
      for (const id of teamA) { rows[id].winsRegular += 1; rows[id].points += 3; }
      for (const id of teamB) { rows[id].lossesRegular += 1; rows[id].points += -1; }
    } else if (match.scoreA < match.scoreB) {
      for (const id of teamB) { rows[id].winsRegular += 1; rows[id].points += 3; }
      for (const id of teamA) { rows[id].lossesRegular += 1; rows[id].points += -1; }
    } else {
      if (match.overtimeWinner === 'A') {
        for (const id of teamA) { rows[id].winsOT += 1; rows[id].points += 2; }
        for (const id of teamB) { rows[id].lossesOT += 1; rows[id].points += 1; }
      } else if (match.overtimeWinner === 'B') {
        for (const id of teamB) { rows[id].winsOT += 1; rows[id].points += 2; }
        for (const id of teamA) { rows[id].lossesOT += 1; rows[id].points += 1; }
      }
    }
    for (const id of [...teamA, ...teamB]) {
      rows[id].goalDiff = rows[id].goalsFor - rows[id].goalsAgainst;
    }
  }

  const standings = Object.values(rows).sort(compareStats);

  // positions / shared positions
  let i = 0;
  let currentPos = 1;
  while (i < standings.length) {
    const group = [standings[i]];
    let j = i + 1;
    while (j < standings.length && sameRank(standings[i], standings[j])) {
      group.push(standings[j]);
      j += 1;
    }
    for (const row of group) {
      row.position = currentPos;
      row.sharedPosition = group.length > 1;
    }
    currentPos += group.length;
    i = j;
  }

  const totalBank = tournament.buyIn * tournament.players.length +
    tournament.matches.reduce((sum, m) => sum + ((m.auctionA || 0) * 2) + ((m.auctionB || 0) * 2), 0);

  // placement prizes with shared positions
  let idx = 0;
  let posCursor = 1;
  while (idx < standings.length) {
    const group = [standings[idx]];
    let j = idx + 1;
    while (j < standings.length && sameRank(standings[idx], standings[j])) {
      group.push(standings[j]); j++;
    }
    const endPos = posCursor + group.length - 1;
    let poolPct = 0;
    for (let p = posCursor; p <= endPos; p++) {
      poolPct += PRIZE_PERCENTAGES[p] || 0;
    }
    const perPlayer = totalBank * poolPct / 100 / group.length;
    for (const row of group) row.prize = Math.round(perPlayer);
    posCursor = endPos + 1;
    idx = j;
  }

  // top scorer
  const maxGF = Math.max(...standings.map((s) => s.goalsFor));
  const scorerWinners = standings.filter((s) => s.goalsFor === maxGF);
  const scorerPrizeEach = Math.round((totalBank * TOP_SCORER_PERCENT / 100) / scorerWinners.length);
  scorerWinners.forEach((s) => s.topScorerPrize = scorerPrizeEach);

  // top defense (minimum conceded)
  const minGA = Math.min(...standings.map((s) => s.goalsAgainst));
  const defenseWinners = standings.filter((s) => s.goalsAgainst === minGA);
  const defensePrizeEach = Math.round((totalBank * TOP_DEFENSE_PERCENT / 100) / defenseWinners.length);
  defenseWinners.forEach((s) => s.topDefensePrize = defensePrizeEach);

  standings.forEach((s) => {
    s.revenue = s.prize + s.topScorerPrize + s.topDefensePrize;
    s.net = s.revenue - s.totalCosts;
  });

  return {
    standings,
    finance: standings.map((s) => ({
      playerId: s.playerId,
      slot: s.slot,
      name: s.name,
      buyIn: s.buyIn,
      auctionCost: s.auctionCost,
      totalCosts: s.totalCosts,
      placementPrize: s.prize,
      topScorerPrize: s.topScorerPrize,
      topDefensePrize: s.topDefensePrize,
      totalRevenue: s.revenue,
      net: s.net
    })),
    totalBank,
    topScorers: scorerWinners.map((s) => s.name),
    topDefenses: defenseWinners.map((s) => s.name)
  };
}

function tournamentResponse(tournament) {
  const calculated = calculateTournament(tournament);
  return {
    ...tournament,
    standings: calculated.standings,
    finance: calculated.finance,
    totalBank: calculated.totalBank,
    topScorers: calculated.topScorers,
    topDefenses: calculated.topDefenses
  };
}

module.exports = { calculateTournament, tournamentResponse };
