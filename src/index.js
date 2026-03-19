require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const { ALLOWED_USERS, MATCH_PATTERN } = require('./constants');
const { tournamentResponse, calculateTournament } = require('./calc');
const { buildTournamentWorkbook } = require('./export');
const { teamCatalog } = require('./teamCatalog');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

function normalizeOrigin(value) {
  return (value || '').trim().replace(/\/$/, '');
}

const allowedOrigins = new Set([
  normalizeOrigin(process.env.WEB_URL),
  normalizeOrigin(process.env.NEXT_PUBLIC_WEB_URL),
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean));

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.has(normalized)) return true;
  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname || '';
    return hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
};

const io = new Server(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'fifa-turnaje-dev-secret';
const NOJBY_PASSWORD = 'Nojby1';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPEN_API_KEY || '';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(fc|cf|sc|afc|if|bk|ac|as|sv|fk|club|de|cd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCandidateName(teamName, candidate) {
  const base = normalizeText(teamName);
  const probe = normalizeText(candidate);
  if (!base || !probe) return 0;
  if (base === probe) return 100;
  if (base.includes(probe) || probe.includes(base)) return 92;
  const baseWords = new Set(base.split(' '));
  const probeWords = probe.split(' ').filter(Boolean);
  const hits = probeWords.filter((word) => baseWords.has(word)).length;
  if (!probeWords.length) return 0;
  return Math.round((hits / probeWords.length) * 80);
}

function matchTeamByName(teams, candidate) {
  if (!candidate) return null;
  let best = null;
  for (const team of teams) {
    const score = scoreCandidateName(team.name, candidate);
    if (!best || score > best.score) best = { team, score };
  }
  return best && best.score >= 55 ? best : null;
}

function dataUrlBytes(dataUrl) {
  const payload = String(dataUrl || '').split(',')[1] || '';
  return Buffer.byteLength(payload, 'base64');
}

function sanitizeDataUrl(dataUrl) {
  const value = String(dataUrl || '').trim();
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) {
    throw new Error('Fotka musí být PNG, JPG nebo WEBP ve formátu base64');
  }
  const bytes = dataUrlBytes(value);
  if (bytes > 8 * 1024 * 1024) {
    throw new Error('Fotka je příliš velká i po kompresi. Zkus být blíž TV nebo udělat menší výřez.');
  }
  return value;
}

async function callOpenAIChatVision(imageDataUrl, teams) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Na fotce je výběr týmů v EA SPORTS FC 26 na TV obrazovce. Najdi pouze dva zvolené mužské týmy. ' +
              'Vrať jen JSON ve tvaru {"homeTeam":"...","awayTeam":"..."}. ' +
              'Neuváděj žádný další text. Dostupné týmy jsou: ' + teams.map((team) => team.name).join(', ')
          },
          {
            type: 'image_url',
            image_url: { url: imageDataUrl, detail: 'low' }
          }
        ]
      }],
      max_completion_tokens: 200
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI čtení fotky selhalo: ${errorText}`);
  }

  const data = await response.json();
  const outputText = data.choices?.[0]?.message?.content || '';
  const parsed = extractJsonBlock(outputText);
  if (!parsed?.homeTeam || !parsed?.awayTeam) {
    throw new Error('Z fotky se nepodařilo spolehlivě přečíst oba týmy');
  }
  return parsed;
}

function extractJsonBlock(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function extractTeamsFromImage(imageDataUrl, teams) {
  if (!OPENAI_API_KEY) {
    throw new Error('Na serveru chybí OPENAI_API_KEY pro čtení týmů z fotky');
  }

  const safeImageDataUrl = sanitizeDataUrl(imageDataUrl);

  let parsed = null;
  let firstError = null;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Na fotce je výběr týmů v EA SPORTS FC 26 na TV obrazovce. Najdi pouze dva zvolené mužské týmy. ' +
                'Vrať jen JSON ve tvaru {"homeTeam":"...","awayTeam":"..."}. ' +
                'Použij co nejpřesnější oficiální názvy. Dostupné týmy jsou: ' + teams.map((team) => team.name).join(', ')
            },
            {
              type: 'input_image',
              image_url: safeImageDataUrl
            }
          ]
        }],
        max_output_tokens: 200
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    const data = await response.json();
    const outputText = data.output_text || data.output?.map((item) => {
      if (item.type !== 'message') return '';
      return (item.content || []).map((part) => part.text || '').join(' ');
    }).join(' ');
    parsed = extractJsonBlock(outputText);
    if (!parsed?.homeTeam || !parsed?.awayTeam) {
      throw new Error('Responses API nevrátila čitelné JSON týmy');
    }
  } catch (err) {
    firstError = err;
    parsed = await callOpenAIChatVision(safeImageDataUrl, teams);
  }

  const homeMatch = matchTeamByName(teams, parsed.homeTeam);
  const awayMatch = matchTeamByName(teams, parsed.awayTeam);
  if (!homeMatch || !awayMatch) {
    throw new Error('Týmy na fotce se nepodařilo bezpečně spárovat s databází FC 26');
  }

  return {
    raw: parsed,
    homeMatch,
    awayMatch,
    warning: firstError ? String(firstError.message || firstError) : ''
  };
}

function signToken(name) {
  return jwt.sign({ name, isNojby: name === 'Nojby' }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireNojby(req, res, next) {
  if (!req.user?.isNojby) return res.status(403).json({ error: 'Tuto akci může provést jen Nojby' });
  return next();
}

async function loadTournament(id) {
  const tournament = await prisma.tournament.findUnique({
    where: { id },
    include: {
      players: true,
      matches: {
        include: {
          teamAPlayer1: true, teamAPlayer2: true,
          teamBPlayer1: true, teamBPlayer2: true,
          benchPlayer1: true, benchPlayer2: true,
          footballTeamA: true, footballTeamB: true
        },
        orderBy: { order: 'asc' }
      }
    }
  });
  if (!tournament) return null;
  return tournamentResponse(tournament);
}


async function ensureTeamCatalog() {
  const count = await prisma.footballTeam.count();
  if (count >= teamCatalog.length) return;
  await prisma.footballTeam.createMany({
    data: teamCatalog.map(([name, country, competition, type]) => ({ name, country, competition, type })),
    skipDuplicates: true
  });
}

async function logAudit(tournamentId, action, entityType, entityId, changedBy, oldValue, newValue) {
  await prisma.auditLog.create({
    data: { tournamentId, action, entityType, entityId, changedBy, oldValue, newValue }
  });
}

function tournamentSummary(t) {
  return {
    id: t.id,
    name: t.name,
    buyIn: t.buyIn,
    status: t.status,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    players: t.players.sort((a,b)=>a.slot.localeCompare(b.slot))
  };
}

function computeStatsFromClosedTournaments(tournaments) {
  const byPlayer = new Map();
  const history = [];

  for (const tournament of tournaments) {
    const calc = calculateTournament(tournament);
    const standings = calc.standings;
    const finance = calc.finance;
    const topScorers = new Set(calc.topScorers);
    const topDefenses = new Set(calc.topDefenses);

    for (const row of standings) {
      if (!byPlayer.has(row.name)) {
        byPlayer.set(row.name, {
          name: row.name,
          tournaments: 0,
          firstPlaces: 0,
          podiums: 0,
          points: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDiff: 0,
          matchesPlayed: 0,
          net: 0,
          topScorerAwards: 0,
          topDefenseAwards: 0
        });
      }
      const bucket = byPlayer.get(row.name);
      const financeRow = finance.find((item) => item.playerId === row.playerId);
      bucket.tournaments += 1;
      bucket.firstPlaces += row.position === 1 ? 1 : 0;
      bucket.podiums += row.position <= 3 ? 1 : 0;
      bucket.points += row.points;
      bucket.goalsFor += row.goalsFor;
      bucket.goalsAgainst += row.goalsAgainst;
      bucket.goalDiff += row.goalDiff;
      bucket.matchesPlayed += row.played;
      bucket.net += financeRow?.net || 0;
      bucket.topScorerAwards += topScorers.has(row.name) ? 1 : 0;
      bucket.topDefenseAwards += topDefenses.has(row.name) ? 1 : 0;

      history.push({
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        status: tournament.status,
        updatedAt: tournament.updatedAt,
        createdAt: tournament.createdAt,
        playerName: row.name,
        position: row.position,
        sharedPosition: row.sharedPosition,
        points: row.points,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDiff: row.goalDiff,
        net: financeRow?.net || 0,
        totalRevenue: financeRow?.totalRevenue || 0,
        totalCosts: financeRow?.totalCosts || 0,
        placementPrize: financeRow?.placementPrize || 0,
        topScorerPrize: financeRow?.topScorerPrize || 0,
        topDefensePrize: financeRow?.topDefensePrize || 0
      });
    }
  }

  const players = Array.from(byPlayer.values()).sort((a, b) => (
    b.firstPlaces - a.firstPlaces ||
    b.podiums - a.podiums ||
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    a.name.localeCompare(b.name, 'cs')
  ));

  const overview = {
    closedTournaments: tournaments.length,
    totalNet: players.reduce((sum, player) => sum + player.net, 0),
    totalGoals: players.reduce((sum, player) => sum + player.goalsFor, 0),
    totalMatches: players.reduce((sum, player) => sum + player.matchesPlayed, 0)
  };

  history.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) || a.playerName.localeCompare(b.playerName, 'cs'));

  return { overview, players, history };
}

io.on('connection', (socket) => {
  socket.on('join-tournament', (tournamentId) => {
    socket.join(`tournament:${tournamentId}`);
  });
  socket.on('leave-tournament', (tournamentId) => {
    socket.leave(`tournament:${tournamentId}`);
  });
});

app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const expectedPassword = username === 'Nojby' ? NOJBY_PASSWORD : username;
  if (!ALLOWED_USERS.includes(username) || password !== expectedPassword) {
    return res.status(401).json({ error: 'Neplatné přihlášení' });
  }
  return res.json({ token: signToken(username), user: { name: username, isNojby: username === 'Nojby' } });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/teams', auth, async (_req, res) => {
  await ensureTeamCatalog();
  const teams = await prisma.footballTeam.findMany({ orderBy: [{ country: 'asc' }, { competition: 'asc' }, { name: 'asc' }] });
  res.json(teams);
});

app.get('/api/tournaments', auth, async (_req, res) => {
  const tournaments = await prisma.tournament.findMany({
    where: { status: { not: 'archived' } },
    include: { players: true },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(tournaments.map(tournamentSummary));
});

app.get('/api/stats', auth, async (_req, res) => {
  const tournaments = await prisma.tournament.findMany({
    where: { status: 'closed' },
    include: {
      players: true,
      matches: {
        include: {
          teamAPlayer1: true, teamAPlayer2: true,
          teamBPlayer1: true, teamBPlayer2: true,
          benchPlayer1: true, benchPlayer2: true,
          footballTeamA: true, footballTeamB: true
        },
        orderBy: { order: 'asc' }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(computeStatsFromClosedTournaments(tournaments));
});

app.post('/api/tournaments', auth, async (req, res) => {
  const { name, buyIn, players } = req.body || {};
  if (!name || !Array.isArray(players) || players.length !== 6) {
    return res.status(400).json({ error: 'Neplatná data turnaje' });
  }
  const created = await prisma.tournament.create({
    data: {
      name,
      buyIn: Number(buyIn) || 0,
      createdBy: req.user.name,
      status: 'draft'
    }
  });

  const sortedPlayers = players.slice().sort((a, b) => a.slot.localeCompare(b.slot));
  const playerRows = {};
  for (const p of sortedPlayers) {
    const createdPlayer = await prisma.player.create({
      data: { tournamentId: created.id, slot: p.slot, name: p.name || p.slot }
    });
    playerRows[p.slot] = createdPlayer;
  }

  for (const pattern of MATCH_PATTERN) {
    await prisma.match.create({
      data: {
        tournamentId: created.id,
        order: pattern.order,
        teamAPlayer1Id: playerRows[pattern.teamA[0]].id,
        teamAPlayer2Id: playerRows[pattern.teamA[1]].id,
        teamBPlayer1Id: playerRows[pattern.teamB[0]].id,
        teamBPlayer2Id: playerRows[pattern.teamB[1]].id,
        benchPlayer1Id: playerRows[pattern.bench[0]].id,
        benchPlayer2Id: playerRows[pattern.bench[1]].id
      }
    });
  }

  await logAudit(created.id, 'create', 'tournament', created.id, req.user.name, null, { name, buyIn, players });
  const full = await loadTournament(created.id);
  res.json(full);
});

app.get('/api/tournaments/:id', auth, async (req, res) => {
  const tournament = await loadTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnaj nenalezen' });
  res.json(tournament);
});

app.patch('/api/tournaments/:id', auth, async (req, res) => {
  const { name, buyIn, players } = req.body || {};
  const current = await prisma.tournament.findUnique({ where: { id: req.params.id }, include: { players: true } });
  if (!current) return res.status(404).json({ error: 'Turnaj nenalezen' });
  if (current.status === 'closed') return res.status(400).json({ error: 'Uzavřený turnaj už nelze upravovat' });

  await prisma.tournament.update({
    where: { id: req.params.id },
    data: {
      name: name ?? current.name,
      buyIn: buyIn == null ? current.buyIn : Number(buyIn)
    }
  });

  if (Array.isArray(players)) {
    for (const p of players) {
      const old = current.players.find((x) => x.id === p.id);
      if (old && old.name !== p.name) {
        await prisma.player.update({ where: { id: p.id }, data: { name: p.name } });
      }
    }
  }

  await logAudit(req.params.id, 'update', 'tournament', req.params.id, req.user.name, current, { name, buyIn, players });
  const full = await loadTournament(req.params.id);
  io.to(`tournament:${req.params.id}`).emit('tournament-updated');
  res.json(full);
});

app.patch('/api/tournaments/:id/status', auth, requireNojby, async (req, res) => {
  const { status } = req.body || {};
  if (!['closed', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'Neplatný status turnaje' });
  }
  const current = await prisma.tournament.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Turnaj nenalezen' });

  const updated = await prisma.tournament.update({
    where: { id: req.params.id },
    data: { status }
  });
  await logAudit(req.params.id, status === 'closed' ? 'close' : 'archive', 'tournament', req.params.id, req.user.name, current, updated);
  io.to(`tournament:${req.params.id}`).emit('tournament-updated');
  res.json(await loadTournament(req.params.id));
});

app.delete('/api/tournaments/:id', auth, requireNojby, async (req, res) => {
  const current = await prisma.tournament.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Turnaj nenalezen' });

  await logAudit(req.params.id, 'delete', 'tournament', req.params.id, req.user.name, current, null);
  await prisma.tournament.delete({ where: { id: req.params.id } });
  io.to(`tournament:${req.params.id}`).emit('tournament-updated');
  res.json({ ok: true });
});

app.patch('/api/matches/:id', auth, async (req, res) => {
  const current = await prisma.match.findUnique({
    where: { id: req.params.id },
    include: { footballTeamA: true, footballTeamB: true, tournament: true }
  });
  if (!current) return res.status(404).json({ error: 'Zápas nenalezen' });
  if (current.tournament?.status === 'closed' && !req.user?.isNojby) return res.status(400).json({ error: 'Uzavřený turnaj už nelze upravovat' });

  const { scoreA, scoreB, overtimeWinner, auctionA, auctionB, footballTeamAId, footballTeamBId } = req.body || {};

  if (footballTeamAId || footballTeamBId) {
    const used = await prisma.match.findMany({
      where: {
        tournamentId: current.tournamentId,
        NOT: { id: current.id }
      },
      select: { footballTeamAId: true, footballTeamBId: true }
    });
    const usedIds = new Set(used.flatMap((m) => [m.footballTeamAId, m.footballTeamBId]).filter(Boolean));
    if (footballTeamAId && usedIds.has(footballTeamAId)) return res.status(400).json({ error: 'FC tým A už je v turnaji použitý' });
    if (footballTeamBId && usedIds.has(footballTeamBId)) return res.status(400).json({ error: 'FC tým B už je v turnaji použitý' });
    if (footballTeamAId && footballTeamBId && footballTeamAId === footballTeamBId) return res.status(400).json({ error: 'Stejný tým nelze použít na obou stranách zápasu' });
  }

  const updated = await prisma.match.update({
    where: { id: current.id },
    data: {
      scoreA: scoreA === '' || scoreA == null ? null : Number(scoreA),
      scoreB: scoreB === '' || scoreB == null ? null : Number(scoreB),
      overtimeWinner: overtimeWinner || null,
      auctionA: Number(auctionA) || 0,
      auctionB: Number(auctionB) || 0,
      footballTeamAId: footballTeamAId || null,
      footballTeamBId: footballTeamBId || null
    }
  });
  const tournament = await prisma.tournament.findUnique({ where: { id: current.tournamentId } });
  if (tournament?.status === 'draft' && updated.scoreA != null && updated.scoreB != null) {
    await prisma.tournament.update({ where: { id: current.tournamentId }, data: { status: 'in_progress' } });
  }

  await logAudit(current.tournamentId, 'update', 'match', current.id, req.user.name, current, updated);
  io.to(`tournament:${current.tournamentId}`).emit('tournament-updated');
  res.json(await loadTournament(current.tournamentId));
});


app.post('/api/matches/:id/extract-teams', auth, async (req, res) => {
  await ensureTeamCatalog();
  const { imageDataUrl } = req.body || {};
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'Chybí fotka pro vytěžení týmů' });
  }

  const current = await prisma.match.findUnique({ where: { id: req.params.id }, include: { tournament: true } });
  if (!current) return res.status(404).json({ error: 'Zápas nenalezen' });
  if (current.tournament?.status === 'closed' && !req.user?.isNojby) {
    return res.status(400).json({ error: 'Uzavřený turnaj už nelze upravovat' });
  }

  const teams = await prisma.footballTeam.findMany({ orderBy: [{ country: 'asc' }, { competition: 'asc' }, { name: 'asc' }] });
  try {
    const detected = await extractTeamsFromImage(imageDataUrl, teams);
    return res.json({
      homeTeamId: detected.homeMatch?.team.id || '',
      awayTeamId: detected.awayMatch?.team.id || '',
      rawHomeTeam: detected.raw.homeTeam,
      rawAwayTeam: detected.raw.awayTeam,
      warning: detected.warning || ''
    });
  } catch (err) {
    const message = String(err?.message || 'Čtení týmů z fotky selhalo');
    const status = /chyb[ií] OPENAI_API_KEY/i.test(message) ? 503 : /příliš velká|formatu base64/i.test(message) ? 413 : 500;
    return res.status(status).json({ error: message });
  }
});

app.get('/api/tournaments/:id/audit', auth, async (req, res) => {
  if (!req.user.isNojby) return res.status(403).json({ error: 'Pouze Nojby může číst audit' });
  const rows = await prisma.auditLog.findMany({ where: { tournamentId: req.params.id }, orderBy: { createdAt: 'desc' } });
  res.json(rows);
});

app.get('/api/tournaments/:id/export', auth, async (req, res) => {
  const tournament = await loadTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnaj nenalezen' });
  const workbook = buildTournamentWorkbook(tournament);
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(tournament.name)}.xlsx"`);
  res.send(Buffer.from(buffer));
});

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
