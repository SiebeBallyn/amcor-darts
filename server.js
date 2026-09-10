const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'amcor-admin';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-before-production';
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS players_normalized_name_unique ON players(normalized_name);
    CREATE TABLE IF NOT EXISTS throws (
      id BIGSERIAL PRIMARY KEY,
      player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      score INTEGER NOT NULL CHECK (score >= 0 AND score <= 180),
      throw_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_throw_per_player_per_day ON throws(player_id, throw_date);
  `);
}

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(__dirname));

app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'admin.html')));

function localDate() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function shiftDate(dateStr, days) { const d=new Date(dateStr+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function weekStart(dateStr=localDate()) { const d=new Date(dateStr+'T12:00:00Z'); const day=d.getUTCDay(); d.setUTCDate(d.getUTCDate()+(day===0?-6:1-day)); return d.toISOString().slice(0,10); }
function weekEnd(start) { return shiftDate(start,6); }
function weekLabel(start) {
  const fmt = new Intl.DateTimeFormat('nl-BE',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Brussels'});
  return `${fmt.format(new Date(start+'T12:00:00Z'))} – ${fmt.format(new Date(weekEnd(start)+'T12:00:00Z'))}`;
}
function cleanName(v){ return String(v||'').trim().replace(/\s+/g,' '); }
function requirePlayer(req,res,next){ if(!req.session.player) return res.status(401).json({error:'Geef eerst je naam in.'}); next(); }
function requireAdmin(req,res,next){ if(!req.session.admin) return res.status(401).json({error:'Admin login vereist.'}); next(); }

async function getPlayer(id){ const r=await query('SELECT id,name,active FROM players WHERE id=$1',[id]); return r.rows[0]; }
async function leaderboard(start){
  const end=weekEnd(start);
  const r=await query(`SELECT p.id,p.name,MAX(t.score)::int AS best,COUNT(t.id)::int AS throws
    FROM players p LEFT JOIN throws t ON t.player_id=p.id AND t.throw_date BETWEEN $1 AND $2
    WHERE p.active=true GROUP BY p.id,p.name HAVING COUNT(t.id)>0
    ORDER BY best DESC, throws ASC, p.name COLLATE "C" ASC`,[start,end]);
  return r.rows;
}

app.get('/api/config',(req,res)=>{const s=weekStart();res.json({siteName:'Amcor Darts Challenge',location:'Roeselare',today:localDate(),weekStart:s,weekEnd:weekEnd(s),label:weekLabel(s)});});
app.get('/api/public-players',async(req,res)=>{try{const r=await query('SELECT name FROM players WHERE active=true ORDER BY lower(name)');res.json({players:r.rows});}catch(e){res.status(500).json({error:'Kon deelnemers niet laden.'});}});
app.get('/api/me',(req,res)=>res.json({player:req.session.player||null,admin:!!req.session.admin,today:localDate()}));

app.post('/api/select-player',async(req,res)=>{
  try {
    const name=cleanName(req.body.name);
    if(!name || name.length>60) return res.status(400).json({error:'Geef een geldige naam in.'});
    const r=await query('SELECT id,name,active FROM players WHERE normalized_name=lower(trim($1))',[name]);
    const p=r.rows[0];
    if(!p || !p.active) return res.status(401).json({error:'Deze naam staat niet in de deelnemerslijst. Vraag de organisatie om hulp.'});
    req.session.player={id:p.id,name:p.name};
    res.json({player:req.session.player});
  } catch(e){ console.error(e); res.status(500).json({error:'Er ging iets mis bij het kiezen van je naam.'}); }
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get('/api/today',requirePlayer,async(req,res)=>{
  try{const date=localDate();const r=await query('SELECT score FROM throws WHERE player_id=$1 AND throw_date=$2',[req.session.player.id,date]);res.json({submitted:!!r.rows[0],score:r.rows[0]?.score??null,date});}
  catch(e){res.status(500).json({error:'Kon je worp niet laden.'});}
});

app.post('/api/scores',requirePlayer,async(req,res)=>{
  try{
    const score=Number(req.body.score),date=localDate();
    if(!Number.isInteger(score)||score<0||score>180)return res.status(400).json({error:'Geef een volledige score tussen 0 en 180 in.'});
    const player=await getPlayer(req.session.player.id);
    if(!player?.active)return res.status(403).json({error:'Je deelname is gedeactiveerd.'});
    try {
      const r=await query('INSERT INTO throws(player_id,score,throw_date) VALUES($1,$2,$3) RETURNING id,score,throw_date',[player.id,score,date]);
      res.json({ok:true,score:r.rows[0].score,date:r.rows[0].throw_date});
    } catch(e) {
      if(e.code==='23505') return res.status(409).json({error:'Je hebt vandaag al een worp ingediend.'});
      throw e;
    }
  }catch(e){console.error(e);res.status(500).json({error:'De worp kon niet worden opgeslagen.'});}
});

app.get('/api/leaderboard',async(req,res)=>{try{const start=req.query.week||weekStart();res.json({weekStart:start,weekEnd:weekEnd(start),label:weekLabel(start),rows:await leaderboard(start)});}catch(e){res.status(500).json({error:'Kon het klassement niet laden.'});}});

app.get('/api/my-stats',requirePlayer,async(req,res)=>{
  try{
    const start=weekStart(),end=weekEnd(start);
    const week=await query('SELECT COUNT(*)::int AS throws, MAX(score)::int AS best, COALESCE(AVG(score),0)::numeric(10,2) AS average FROM throws WHERE player_id=$1 AND throw_date BETWEEN $2 AND $3',[req.session.player.id,start,end]);
    const all=await query('SELECT COUNT(*)::int AS throws, COALESCE(AVG(score),0)::numeric(10,2) AS average, MAX(score)::int AS best FROM throws WHERE player_id=$1',[req.session.player.id]);
    const history=await query('SELECT throw_date,score,date_trunc(\'week\',throw_date)::date AS week_start FROM throws WHERE player_id=$1 ORDER BY throw_date DESC LIMIT 50',[req.session.player.id]);
    res.json({week:week.rows[0],allTime:all.rows[0],history:history.rows});
  }catch(e){console.error(e);res.status(500).json({error:'Kon je statistieken niet laden.'});}
});

app.post('/api/admin/login',(req,res)=>{if(String(req.body.password||'')!==ADMIN_PASSWORD)return res.status(401).json({error:'Verkeerd admin-wachtwoord.'});req.session.admin=true;res.json({ok:true});});
app.post('/api/admin/logout',(req,res)=>{req.session.admin=false;res.json({ok:true});});
app.get('/api/admin/players',requireAdmin,async(req,res)=>{try{const r=await query('SELECT id,name,active FROM players ORDER BY active DESC,lower(name)');res.json(r.rows);}catch(e){res.status(500).json({error:'Kon deelnemers niet laden.'});}});
app.post('/api/admin/players',requireAdmin,async(req,res)=>{try{const name=cleanName(req.body.name);if(!name||name.length>60)return res.status(400).json({error:'Geef een geldige naam in.'});const r=await query('INSERT INTO players(name,active) VALUES($1,true) RETURNING id,name',[name]);res.json({ok:true,...r.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Deze naam bestaat al.'});res.status(500).json({error:'Deelnemer kon niet worden toegevoegd.'});}});
app.patch('/api/admin/players/:id',requireAdmin,async(req,res)=>{try{const id=Number(req.params.id);if(req.body.name!==undefined){const name=cleanName(req.body.name);if(!name||name.length>60)return res.status(400).json({error:'Ongeldige naam.'});await query('UPDATE players SET name=$1 WHERE id=$2',[name,id]);}if(req.body.active!==undefined)await query('UPDATE players SET active=$1 WHERE id=$2',[!!req.body.active,id]);res.json({ok:true});}catch(e){if(e.code==='23505')return res.status(409).json({error:'Naam bestaat al.'});res.status(500).json({error:'Deelnemer kon niet worden aangepast.'});}});
app.delete('/api/admin/players/:id',requireAdmin,async(req,res)=>{try{await query('UPDATE players SET active=false WHERE id=$1',[Number(req.params.id)]);res.json({ok:true});}catch(e){res.status(500).json({error:'Deelnemer kon niet worden gedeactiveerd.'});}});
app.get('/api/admin/winner',requireAdmin,async(req,res)=>{try{const start=req.query.week||weekStart();const rows=await leaderboard(start);res.json({weekStart:start,weekEnd:weekEnd(start),winner:rows[0]||null,final:start!==weekStart()});}catch(e){res.status(500).json({error:'Kon winnaar niet laden.'});}});
app.get('/api/admin/scores',requireAdmin,async(req,res)=>{try{const start=req.query.week||weekStart(),end=weekEnd(start);const r=await query(`SELECT t.id,p.name,t.score,t.throw_date FROM throws t JOIN players p ON p.id=t.player_id WHERE t.throw_date BETWEEN $1 AND $2 ORDER BY t.throw_date DESC,t.id DESC`,[start,end]);res.json(r.rows);}catch(e){res.status(500).json({error:'Kon worpen niet laden.'});}});
app.get('/api/admin/history',requireAdmin,async(req,res)=>{try{const r=await query(`SELECT t.id,p.name,t.score,t.throw_date,date_trunc('week',t.throw_date)::date AS week_start FROM throws t JOIN players p ON p.id=t.player_id ORDER BY t.throw_date DESC,t.id DESC LIMIT 500`);res.json(r.rows);}catch(e){res.status(500).json({error:'Kon historiek niet laden.'});}});

initDatabase().then(()=>app.listen(PORT,()=>console.log(`Amcor Darts draait op poort ${PORT}`))).catch(e=>{console.error('Database initialisatie mislukt:',e);process.exit(1);});
