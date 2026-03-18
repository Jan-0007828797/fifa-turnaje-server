
const ALLOWED_USERS = ["Nojby", "Mojda", "Badger", "Wowi", "Gorky", "Blazena"];
const MATCH_PATTERN = [
  {
    "order": 1,
    "teamA": [
      "A",
      "B"
    ],
    "teamB": [
      "C",
      "D"
    ],
    "bench": [
      "E",
      "F"
    ]
  },
  {
    "order": 2,
    "teamA": [
      "A",
      "E"
    ],
    "teamB": [
      "C",
      "F"
    ],
    "bench": [
      "B",
      "D"
    ]
  },
  {
    "order": 3,
    "teamA": [
      "B",
      "D"
    ],
    "teamB": [
      "E",
      "F"
    ],
    "bench": [
      "A",
      "C"
    ]
  },
  {
    "order": 4,
    "teamA": [
      "B",
      "C"
    ],
    "teamB": [
      "A",
      "D"
    ],
    "bench": [
      "E",
      "F"
    ]
  },
  {
    "order": 5,
    "teamA": [
      "A",
      "F"
    ],
    "teamB": [
      "C",
      "E"
    ],
    "bench": [
      "B",
      "D"
    ]
  },
  {
    "order": 6,
    "teamA": [
      "B",
      "E"
    ],
    "teamB": [
      "D",
      "F"
    ],
    "bench": [
      "A",
      "C"
    ]
  },
  {
    "order": 7,
    "teamA": [
      "A",
      "C"
    ],
    "teamB": [
      "D",
      "E"
    ],
    "bench": [
      "B",
      "F"
    ]
  },
  {
    "order": 8,
    "teamA": [
      "B",
      "F"
    ],
    "teamB": [
      "A",
      "E"
    ],
    "bench": [
      "C",
      "D"
    ]
  },
  {
    "order": 9,
    "teamA": [
      "B",
      "C"
    ],
    "teamB": [
      "D",
      "F"
    ],
    "bench": [
      "A",
      "E"
    ]
  }
];
const PRIZE_PERCENTAGES = {
  1: 35,
  2: 25,
  3: 15,
  4: 10,
  5: 5
};
const TOP_SCORER_PERCENT = 5;
const TOP_DEFENSE_PERCENT = 5;

module.exports = {
  ALLOWED_USERS,
  MATCH_PATTERN,
  PRIZE_PERCENTAGES,
  TOP_SCORER_PERCENT,
  TOP_DEFENSE_PERCENT
};
