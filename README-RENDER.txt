AMCOR DARTS - SUPABASE / RENDER

1. GitHub: vervang de bestaande websitebestanden door de bestanden in deze map.
2. Zorg dat package.json aanwezig is. Render gebruikt automatisch `npm install` en `npm start`.
3. Render Environment Variables toevoegen:
   DATABASE_URL = jouw Supabase Session Pooler URI (URI, niet PSQL)
   ADMIN_PASSWORD = je bestaande admin-wachtwoord
   SESSION_SECRET = een lange willekeurige geheime tekst
4. Deploy.

BELANGRIJK:
- Deel DATABASE_URL nooit publiek; deze bevat het databasewachtwoord.
- De website gebruikt nu PostgreSQL/Supabase en niet meer SQLite/better-sqlite3.
- De Supabase-tabellen `players` en `throws` kunnen al bestaan; server.js controleert dit veilig.
- Spelers worden gezocht op lower(trim(name)), dus hoofdletters/spaties maken geen verschil.
- Er is maximaal 1 worp per speler per kalenderdag.
- De week loopt maandag t/m zondag.
