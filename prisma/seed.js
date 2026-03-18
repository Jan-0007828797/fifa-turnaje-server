
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const teams = [
  [
    "Arsenal",
    "England",
    "Premier League",
    "club"
  ],
  [
    "Liverpool",
    "England",
    "Premier League",
    "club"
  ],
  [
    "Manchester City",
    "England",
    "Premier League",
    "club"
  ],
  [
    "Chelsea",
    "England",
    "Premier League",
    "club"
  ],
  [
    "Manchester United",
    "England",
    "Premier League",
    "club"
  ],
  [
    "Tottenham Hotspur",
    "England",
    "Premier League",
    "club"
  ],
  [
    "Real Madrid",
    "Spain",
    "LaLiga EA SPORTS",
    "club"
  ],
  [
    "FC Barcelona",
    "Spain",
    "LaLiga EA SPORTS",
    "club"
  ],
  [
    "Atlético Madrid",
    "Spain",
    "LaLiga EA SPORTS",
    "club"
  ],
  [
    "Athletic Club",
    "Spain",
    "LaLiga EA SPORTS",
    "club"
  ],
  [
    "Paris Saint-Germain",
    "France",
    "Ligue 1 McDonald's",
    "club"
  ],
  [
    "Olympique de Marseille",
    "France",
    "Ligue 1 McDonald's",
    "club"
  ],
  [
    "AS Monaco",
    "France",
    "Ligue 1 McDonald's",
    "club"
  ],
  [
    "Bayern München",
    "Germany",
    "Bundesliga",
    "club"
  ],
  [
    "Bayer 04 Leverkusen",
    "Germany",
    "Bundesliga",
    "club"
  ],
  [
    "Borussia Dortmund",
    "Germany",
    "Bundesliga",
    "club"
  ],
  [
    "RB Leipzig",
    "Germany",
    "Bundesliga",
    "club"
  ],
  [
    "Juventus",
    "Italy",
    "Serie A Enilive",
    "club"
  ],
  [
    "Inter",
    "Italy",
    "Serie A Enilive",
    "club"
  ],
  [
    "AC Milan",
    "Italy",
    "Serie A Enilive",
    "club"
  ],
  [
    "Napoli",
    "Italy",
    "Serie A Enilive",
    "club"
  ],
  [
    "Roma",
    "Italy",
    "Serie A Enilive",
    "club"
  ],
  [
    "Ajax",
    "Netherlands",
    "Eredivisie",
    "club"
  ],
  [
    "PSV",
    "Netherlands",
    "Eredivisie",
    "club"
  ],
  [
    "Feyenoord",
    "Netherlands",
    "Eredivisie",
    "club"
  ],
  [
    "Sporting CP",
    "Portugal",
    "Liga Portugal",
    "club"
  ],
  [
    "SL Benfica",
    "Portugal",
    "Liga Portugal",
    "club"
  ],
  [
    "FC Porto",
    "Portugal",
    "Liga Portugal",
    "club"
  ],
  [
    "Club Brugge KV",
    "Belgium",
    "Pro League",
    "club"
  ],
  [
    "Union Saint-Gilloise",
    "Belgium",
    "Pro League",
    "club"
  ],
  [
    "KRC Genk",
    "Belgium",
    "Pro League",
    "club"
  ],
  [
    "Galatasaray",
    "Türkiye",
    "Süper Lig",
    "club"
  ],
  [
    "Fenerbahçe",
    "Türkiye",
    "Süper Lig",
    "club"
  ],
  [
    "Beşiktaş",
    "Türkiye",
    "Süper Lig",
    "club"
  ],
  [
    "Olympiacos CFP",
    "Greece",
    "Super League",
    "club"
  ],
  [
    "PAOK",
    "Greece",
    "Super League",
    "club"
  ],
  [
    "Panathinaikos",
    "Greece",
    "Super League",
    "club"
  ],
  [
    "Celtic",
    "Scotland",
    "Scottish Premiership",
    "club"
  ],
  [
    "Rangers",
    "Scotland",
    "Scottish Premiership",
    "club"
  ],
  [
    "FC København",
    "Denmark",
    "Superliga",
    "club"
  ],
  [
    "FC Midtjylland",
    "Denmark",
    "Superliga",
    "club"
  ],
  [
    "RB Salzburg",
    "Austria",
    "Bundesliga",
    "club"
  ],
  [
    "SK Sturm Graz",
    "Austria",
    "Bundesliga",
    "club"
  ],
  [
    "Young Boys",
    "Switzerland",
    "Credit Suisse Super League",
    "club"
  ],
  [
    "FC Basel 1893",
    "Switzerland",
    "Credit Suisse Super League",
    "club"
  ],
  [
    "Slavia Praha",
    "Czechia",
    "Chance Liga",
    "club"
  ],
  [
    "Sparta Praha",
    "Czechia",
    "Chance Liga",
    "club"
  ],
  [
    "Viktoria Plzeň",
    "Czechia",
    "Chance Liga",
    "club"
  ],
  [
    "Lech Poznań",
    "Poland",
    "PKO BP Ekstraklasa",
    "club"
  ],
  [
    "Legia Warszawa",
    "Poland",
    "PKO BP Ekstraklasa",
    "club"
  ],
  [
    "Crvena zvezda",
    "Serbia",
    "SuperLiga",
    "club"
  ],
  [
    "Partizan",
    "Serbia",
    "SuperLiga",
    "club"
  ],
  [
    "Shakhtar Donetsk",
    "Ukraine",
    "Premier League",
    "club"
  ],
  [
    "Dynamo Kyiv",
    "Ukraine",
    "Premier League",
    "club"
  ],
  [
    "River Plate",
    "Argentina",
    "Liga Profesional",
    "club"
  ],
  [
    "Boca Juniors",
    "Argentina",
    "Liga Profesional",
    "club"
  ],
  [
    "Flamengo",
    "Brazil",
    "Série A",
    "club"
  ],
  [
    "Palmeiras",
    "Brazil",
    "Série A",
    "club"
  ],
  [
    "São Paulo",
    "Brazil",
    "Série A",
    "club"
  ],
  [
    "Club América",
    "Mexico",
    "Liga MX",
    "club"
  ],
  [
    "Guadalajara",
    "Mexico",
    "Liga MX",
    "club"
  ],
  [
    "Monterrey",
    "Mexico",
    "Liga MX",
    "club"
  ],
  [
    "Al Hilal",
    "Saudi Arabia",
    "Saudi Pro League",
    "club"
  ],
  [
    "Al Nassr",
    "Saudi Arabia",
    "Saudi Pro League",
    "club"
  ],
  [
    "LAFC",
    "USA",
    "MLS",
    "club"
  ],
  [
    "Inter Miami",
    "USA",
    "MLS",
    "club"
  ],
  [
    "LA Galaxy",
    "USA",
    "MLS",
    "club"
  ],
  [
    "Seattle Sounders",
    "USA",
    "MLS",
    "club"
  ],
  [
    "Argentina",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Brazil",
    "International",
    "National Teams",
    "national"
  ],
  [
    "England",
    "International",
    "National Teams",
    "national"
  ],
  [
    "France",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Germany",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Spain",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Italy",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Portugal",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Netherlands",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Belgium",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Croatia",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Czechia",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Poland",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Serbia",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Uruguay",
    "International",
    "National Teams",
    "national"
  ],
  [
    "Mexico",
    "International",
    "National Teams",
    "national"
  ]
];

async function main() {
  for (const [name, country, competition, type] of teams) {
    await prisma.footballTeam.upsert({
      where: { name },
      update: { country, competition, type },
      create: { name, country, competition, type }
    });
  }
  console.log(`Seeded ${teams.length} football teams`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => prisma.$disconnect());
