
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const { ALLOWED_USERS, MATCH_PATTERN } = require('./constants');
const { tournamentResponse } = require('./calc');
const { buildTournamentWorkbook } = require('./export');

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
app.use(express.json({ limit: '2mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'fifa-turnaje-dev-secret';

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
  if (!ALLOWED_USERS.includes(username) || password !== username) {
    return res.status(401).json({ error: 'Neplatné přihlášení' });
  }
  return res.json({ token: signToken(username), user: { name: username, isNojby: username === 'Nojby' } });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/teams', auth, async (_req, res) => {
  const teams = await prisma.footballTeam.findMany({ orderBy: [{ type: 'asc' }, { country: 'asc' }, { name: 'asc' }] });
  res.json(teams);
});

app.get('/api/tournaments', auth, async (_req, res) => {
  const tournaments = await prisma.tournament.findMany({ include: { players: true }, orderBy: { updatedAt: 'desc' } });
  res.json(tournaments.map(tournamentSummary));
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

app.patch('/api/matches/:id', auth, async (req, res) => {
  const current = await prisma.match.findUnique({
    where: { id: req.params.id },
    include: { footballTeamA: true, footballTeamB: true }
  });
  if (!current) return res.status(404).json({ error: 'Zápas nenalezen' });

  const { scoreA, scoreB, overtimeWinner, auctionA, auctionB, footballTeamAId, footballTeamBId } = req.body || {};

  // unique team within tournament
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
  const full = await loadTournament(current.tournamentId);
  io.to(`tournament:${current.tournamentId}`).emit('tournament-updated');
  res.json(full);
});

app.get('/api/tournaments/:id/audit', auth, async (req, res) => {
  if (req.user.name !== 'Nojby') return res.status(403).json({ error: 'Pouze Nojby může zobrazit audit' });
  const rows = await prisma.auditLog.findMany({
    where: { tournamentId: req.params.id },
    orderBy: { createdAt: 'desc' }
  });
  res.json(rows);
});

app.get('/api/tournaments/:id/export', auth, async (req, res) => {
  const tournament = await loadTournament(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Turnaj nenalezen' });
  const workbook = await buildTournamentWorkbook(tournament);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="fifa-turnaj-${req.params.id}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

const port = Number(process.env.PORT || 4000);
server.listen(port, () => {
  console.log(`FIFA turnaje server running on port ${port}`);
});
