
const ExcelJS = require('exceljs');

function currencyFmt(cell) {
  cell.numFmt = '#,##0';
}
function headerRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
}

async function buildTournamentWorkbook(tournament) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenAI';
  workbook.created = new Date();

  const info = workbook.addWorksheet('Turnaj');
  info.columns = [{ width: 24 }, { width: 24 }, { width: 18 }, { width: 18 }];
  info.addRow(['Název turnaje', tournament.name]);
  info.addRow(['Buy-in na hráče', tournament.buyIn]);
  info.addRow(['Bank celkem', tournament.totalBank]);
  info.addRow([]);
  const h1 = info.addRow(['Slot', 'Hráč']);
  headerRow(h1);
  for (const p of tournament.players.sort((a,b)=>a.slot.localeCompare(b.slot))) {
    info.addRow([p.slot, p.name]);
  }
  info.getColumn(2).width = 28;

  const matches = workbook.addWorksheet('Zápasy');
  matches.columns = [
    { width: 8 }, { width: 22 }, { width: 22 }, { width: 18 }, { width: 12 },
    { width: 22 }, { width: 22 }, { width: 18 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 14 }
  ];
  const mr = matches.addRow(['Zápas', 'Tým A hráči', 'Tým B hráči', 'FC tým A', 'Los. A', 'FC tým B', 'Tým B hráči', 'Los. B', 'Skóre A', 'Skóre B', 'OT vítěz']);
  headerRow(mr);
  for (const m of tournament.matches.sort((a,b)=>a.order-b.order)) {
    const teamAPlayers = `${m.teamAPlayer1.name} + ${m.teamAPlayer2.name}`;
    const teamBPlayers = `${m.teamBPlayer1.name} + ${m.teamBPlayer2.name}`;
    matches.addRow([
      m.order,
      teamAPlayers,
      teamBPlayers,
      m.footballTeamA?.name || '',
      m.auctionA || 0,
      m.footballTeamB?.name || '',
      teamBPlayers,
      m.auctionB || 0,
      m.scoreA ?? '',
      m.scoreB ?? '',
      m.overtimeWinner || ''
    ]);
  }

  const standings = workbook.addWorksheet('Tabulka');
  standings.columns = Array.from({ length: 12 }, (_, i) => ({ width: i === 1 ? 24 : 12 }));
  const sr = standings.addRow(['Poř.', 'Hráč', 'Slot', 'Z', 'V', 'VP', 'PP', 'P', 'GF', 'GA', 'GD', 'Body']);
  headerRow(sr);
  for (const s of tournament.standings) {
    standings.addRow([s.position, s.name, s.slot, s.played, s.winsRegular, s.winsOT, s.lossesOT, s.lossesRegular, s.goalsFor, s.goalsAgainst, s.goalDiff, s.points]);
  }

  const finance = workbook.addWorksheet('Finance');
  finance.columns = [
    { width: 22 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }
  ];
  const fr = finance.addRow(['Hráč', 'Slot', 'Buy-in', 'Losovačky', 'Náklady', 'Umístění', 'Top střelec', 'Top obrana', 'Tržby', 'Netto']);
  headerRow(fr);
  for (const f of tournament.finance) {
    finance.addRow([f.name, f.slot, f.buyIn, f.auctionCost, f.totalCosts, f.placementPrize, f.topScorerPrize, f.topDefensePrize, f.totalRevenue, f.net]);
  }

  [info, matches, standings, finance].forEach((sheet) => {
    sheet.eachRow((row, idx) => {
      if (idx > 0) {
        row.eachCell((cell) => {
          if (typeof cell.value === 'number') currencyFmt(cell);
        });
      }
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  });

  return workbook;
}

module.exports = { buildTournamentWorkbook };
