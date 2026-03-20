require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
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
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'fifa-turnaje-dev-secret';
const NOJBY_PASSWORD = 'Nojby1';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPEN_API_KEY || '';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OCR_ENABLED = process.env.DISABLE_LOCAL_OCR !== '1';


const NATIONAL_TEAM_ALIASES = new Map([
  ['Argentina', ['Argentina']],
  ['Croatia', ['Croatia', 'Chorvatsko']],
  ['Denmark', ['Denmark', 'Dánsko']],
  ['England', ['England', 'Anglie']],
  ['France', ['France', 'Francie']],
  ['Germany', ['Germany', 'Německo']],
  ['Ghana', ['Ghana']],
  ['Hungary', ['Hungary', 'Maďarsko']],
  ['Italy', ['Italy', 'Itálie']],
  ['Mexico', ['Mexico', 'Mexiko']],
  ['Morocco', ['Morocco', 'Maroko']],
  ['Netherlands', ['Netherlands', 'Nizozemsko']],
  ['Northern Ireland', ['Northern Ireland', 'Severní Irsko']],
  ['Norway', ['Norway', 'Norsko']],
  ['Poland', ['Poland', 'Polsko']],
  ['Portugal', ['Portugal', 'Portugalsko']],
  ['Republic of Ireland', ['Republic of Ireland', 'Irsko', 'Republika Irsko']],
  ['Romania', ['Romania', 'Rumunsko']],
  ['Scotland', ['Scotland', 'Skotsko']],
  ['Spain', ['Spain', 'Španělsko']],
  ['Sweden', ['Sweden', 'Švédsko']],
  ['Ukraine', ['Ukraine', 'Ukrajina']],
  ['United States of America', ['United States of America', 'USA', 'Spojené státy', 'Spojené státy americké']],
  ['Wales', ['Wales']]
]);

const TEAM_ALIASES = new Map([
  ['man utd', 'Manchester United'],
  ['man united', 'Manchester United'],
  ['man city', 'Manchester City'],
  ['psg', 'Paris Saint-Germain'],
  ['bayern', 'Bayern Munich'],
  ['spurs', 'Tottenham Hotspur'],
  ['juve', 'Juventus']
]);

const OCR_NOISE_WORDS = new Set([
  'fc', 'ea', 'sports', 'ultimate', 'team', 'ut', 'kick', 'off', 'match', 'pause', 'resume',
  'stadium', 'settings', 'online', 'squad', 'ready', 'start', 'continue', 'back', 'next',
  'home', 'away', 'domaci', 'hoste', 'pen', 'pens', 'overtime', 'extra', 'time', 'vs'
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(fc|cf|sc|afc|if|bk|ac|as|sv|fk|club|de|cd|the)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dataUrlBytes(dataUrl) {
  const payload = String(dataUrl || '').split(',')[1] || '';
  return Buffer.byteLength(payload, 'base64');
}

function sanitizeDataUrl(dataUrl) {
  const value = String(dataUrl || '').trim();
  if (!/^data:image\/(png|jpeg|jpg|webp|heic|heif);base64,/i.test(value)) {
    throw new Error('Fotka musí být PNG, JPG, WEBP nebo HEIC ve formátu base64');
  }
  const bytes = dataUrlBytes(value);
  if (bytes > 18 * 1024 * 1024) {
    throw new Error('Fotka je příliš velká i po kompresi. Zkus být blíž TV nebo udělat menší výřez.');
  }
  return value;
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

function buildTeamAliases(team) {
  const aliases = new Set([team.name, normalizeText(team.name)]);
  if (team.type === 'national') {
    aliases.add(`${team.name} national`);
    for (const alias of NATIONAL_TEAM_ALIASES.get(team.name) || []) aliases.add(alias);
  }
  for (const [alias, official] of TEAM_ALIASES.entries()) {
    if (official === team.name) aliases.add(alias);
  }
  return Array.from(aliases).map((alias) => normalizeText(alias)).filter(Boolean);
}


function sanitizeOcrLine(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d+([:\-.]\d+)*$/.test(raw)) return '';
  if (!/[A-Za-zÀ-ÿ]/.test(raw)) return '';
  const normalized = normalizeText(raw);
  if (!normalized || normalized.length < 4) return '';
  if (normalized.split(' ').every((word) => OCR_NOISE_WORDS.has(word))) return '';
  return normalized;
}

function uniquePush(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function collectOcrCandidates(ocrData) {
  const candidates = [];
  for (const line of ocrData.lines || []) {
    uniquePush(candidates, sanitizeOcrLine(line.text || ''));
  }
  const words = (ocrData.words || []).map((word) => String(word.text || '').trim()).filter(Boolean);
  for (let i = 0; i < words.length; i += 1) {
    uniquePush(candidates, sanitizeOcrLine(words[i]));
    uniquePush(candidates, sanitizeOcrLine(`${words[i]} ${words[i + 1] || ''}`));
    uniquePush(candidates, sanitizeOcrLine(`${words[i]} ${words[i + 1] || ''} ${words[i + 2] || ''}`));
  }
  for (const line of String(ocrData.text || '').split(/\n+/)) {
    uniquePush(candidates, sanitizeOcrLine(line));
  }
  return candidates.filter(Boolean);
}

function scoreCandidateName(teamName, candidate) {
  const base = normalizeText(teamName);
  const probe = normalizeText(candidate);
  if (!base || !probe) return 0;
  if (base === probe) return 100;
  if (base.includes(probe) || probe.includes(base)) return Math.max(88, Math.min(98, probe.length * 2));
  const baseWords = new Set(base.split(' '));
  const probeWords = probe.split(' ').filter(Boolean);
  const hits = probeWords.filter((word) => baseWords.has(word)).length;
  if (!probeWords.length) return 0;
  const coverage = hits / probeWords.length;
  const density = hits / Math.max(baseWords.size, 1);
  return Math.round((coverage * 65) + (density * 25));
}

function matchTeamByName(teams, candidate) {
  if (!candidate) return null;
  let best = null;
  for (const team of teams) {
    const aliases = buildTeamAliases(team);
    const score = aliases.reduce((max, alias) => Math.max(max, scoreCandidateName(alias, candidate)), 0);
    if (!best || score > best.score) best = { team, score };
  }
  return best && best.score >= 55 ? best : null;
}

async function preprocessImageVariants(imageDataUrl) {
  const safeImageDataUrl = sanitizeDataUrl(imageDataUrl);
  const payload = safeImageDataUrl.split(',')[1] || '';
  const inputBuffer = Buffer.from(payload, 'base64');

  const base = sharp(inputBuffer, { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const resizedWidth = Math.min(2200, Math.max(1400, meta.width || 1600));

  const normal = await base.clone().resize({ width: resizedWidth, withoutEnlargement: false }).jpeg({ quality: 84 }).toBuffer();
  const enhanced = await base.clone().resize({ width: resizedWidth, withoutEnlargement: false }).grayscale().normalize().sharpen().jpeg({ quality: 88 }).toBuffer();
  return { safeImageDataUrl, normal, enhanced };
}

async function recognizeTextFromBuffer(buffer) {
  const result = await Tesseract.recognize(buffer, 'eng', {
    logger: () => {},
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1'
  });
  return result?.data || {};
}

function scoreTeamAgainstOcr(team, normalizedText, normalizedLines) {
  const aliases = buildTeamAliases(team);
  let best = 0;
  for (const alias of aliases) {
    if (!alias) continue;
    if (normalizedText.includes(alias)) best = Math.max(best, 100);
    for (const line of normalizedLines) {
      if (!line) continue;
      if (line === alias) best = Math.max(best, 100);
      else if (line.includes(alias) || alias.includes(line)) best = Math.max(best, 93);
      else best = Math.max(best, scoreCandidateName(alias, line));
    }
  }
  return best;
}


function detectTeamsFromOcr(teams, ocrData) {
  const candidates = collectOcrCandidates(ocrData);

  const ranked = teams
    .map((team) => {
      const aliases = buildTeamAliases(team);
      let score = 0;
      let bestCandidate = '';
      for (const candidate of candidates) {
        const nextScore = aliases.reduce((max, alias) => Math.max(max, scoreCandidateName(alias, candidate)), 0);
        if (nextScore > score) {
          score = nextScore;
          bestCandidate = candidate;
        }
      }
      return { team, score, bestCandidate };
    })
    .filter((row) => row.score >= 72)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name, 'cs'));

  const unique = [];
  for (const item of ranked) {
    if (!unique.some((row) => row.team.id === item.team.id)) unique.push(item);
    if (unique.length >= 4) break;
  }

  if (unique.length < 2) {
    throw new Error('Z kamery se nepodařilo přečíst oba týmy dostatečně jistě. Zkus být blíž TV a namiř rámeček jen na názvy týmů.');
  }

  return {
    raw: {
      homeTeam: unique[0].bestCandidate || unique[0].team.name,
      awayTeam: unique[1].bestCandidate || unique[1].team.name
    },
    homeMatch: unique[0],
    awayMatch: unique[1],
    source: 'ocr',
    warning: ''
  };
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
              'Na fotce je obrazovka EA SPORTS FC 26 na TV. Ignoruj všechna čísla, skóre, čas, menu i ostatní text. Najdi pouze dva názvy týmů. ' +
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

async function extractTeamsViaAi(imageDataUrl, teams) {
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
                'Na fotce je obrazovka EA SPORTS FC 26 na TV. Ignoruj všechna čísla, skóre, čas, menu i ostatní text. Najdi pouze dva názvy týmů. ' +
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
    source: 'ai',
    warning: firstError ? String(firstError.message || firstError) : ''
  };
}

async function extractTeamsFromImage(imageDataUrl, teams) {
  const variants = await preprocessImageVariants(imageDataUrl);
  let ocrError = null;

  if (OCR_ENABLED) {
    try {
      const ocrData = await recognizeTextFromBuffer(variants.enhanced);
      const ocrMatch = detectTeamsFromOcr(teams, ocrData);
      if (!OPENAI_API_KEY) return ocrMatch;
      try {
        const aiMatch = await extractTeamsViaAi(variants.safeImageDataUrl, teams);
        return { ...aiMatch, warning: ocrMatch.warning || aiMatch.warning || '' };
      } catch (aiError) {
        return { ...ocrMatch, warning: `AI fallback selhal, použit lokální OCR výsledek: ${String(aiError.message || aiError)}` };
      }
    } catch (err) {
      ocrError = err;
    }
  }

  if (OPENAI_API_KEY) {
    const aiMatch = await extractTeamsViaAi(variants.safeImageDataUrl, teams);
    return { ...aiMatch, warning: ocrError ? `Lokální OCR selhalo: ${String(ocrError.message || ocrError)}` : aiMatch.warning };
  }

  throw new Error(ocrError ? `Lokální OCR selhalo: ${String(ocrError.message || ocrError)}` : 'Foto rozpoznání se nepodařilo spustit');
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
  const existing = await prisma.footballTeam.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((row) => row.name));
  const missing = teamCatalog.filter(([name]) => !existingNames.has(name));
  if (!missing.length) return;
  await prisma.footballTeam.createMany({
    data: missing.map(([name, country, competition, type]) => ({ name, country, competition, type })),
    skipDuplicates: true
  });
}

async function loadAllowedTeams() {
  await ensureTeamCatalog();
  const allowedNames = teamCatalog.map(([name]) => name);
  return prisma.footballTeam.findMany({
    where: { name: { in: allowedNames } },
    orderBy: [{ country: 'asc' }, { competition: 'asc' }, { name: 'asc' }]
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
app.get('/api/health', async (_req, res) => {
  try {
    const teamsCount = (await loadAllowedTeams()).length;
    res.json({ ok: true, ai: OPENAI_API_KEY ? 'on' : 'off', ocr: OCR_ENABLED ? 'on' : 'off', teamsCatalog: teamsCount > 0 ? `ok:${teamsCount}` : 'empty' });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

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
  const teams = await loadAllowedTeams();
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

  if (!footballTeamAId || !footballTeamBId) {
    return res.status(400).json({ error: 'Vyber oba týmy, jinak zápas nelze uložit' });
  }
  if (String(footballTeamAId) === String(footballTeamBId)) {
    return res.status(400).json({ error: 'Stejný tým nelze použít na obou stranách zápasu' });
  }
  if (scoreA != null && scoreB != null && Number(scoreA) === Number(scoreB) && !overtimeWinner) {
    return res.status(400).json({ error: 'Při remíze je nutné zvolit vítěze prodloužení' });
  }

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
  const { imageDataUrl } = req.body || {};
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'Chybí fotka pro vytěžení týmů' });
  }

  const current = await prisma.match.findUnique({ where: { id: req.params.id }, include: { tournament: true } });
  if (!current) return res.status(404).json({ error: 'Zápas nenalezen' });
  if (current.tournament?.status === 'closed' && !req.user?.isNojby) {
    return res.status(400).json({ error: 'Uzavřený turnaj už nelze upravovat' });
  }

  const teams = await loadAllowedTeams();
  try {
    const detected = await extractTeamsFromImage(imageDataUrl, teams);
    return res.json({
      homeTeamId: detected.homeMatch?.team.id || '',
      awayTeamId: detected.awayMatch?.team.id || '',
      rawHomeTeam: detected.raw.homeTeam,
      rawAwayTeam: detected.raw.awayTeam,
      warning: detected.warning || '',
      source: detected.source || 'ocr'
    });
  } catch (err) {
    const message = String(err?.message || 'Čtení týmů z fotky selhalo');
    const status = /příliš velká|formatu base64/i.test(message) ? 413 : /nepodařilo přečíst oba týmy|lokální ocr selhalo|nepodařilo spustit/i.test(message) ? 422 : 500;
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
