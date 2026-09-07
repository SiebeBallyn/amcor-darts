# Amcor Darts Challenge – Roeselare

Interne werknemerscompetitie. Elke actieve werknemer kan maximaal **één worp per dag** indienen.

## Klassement
1. Hoogste individuele worp van de week telt.
2. Bij gelijke hoogste score staat de speler met het minste aantal worpen bovenaan.
3. Bij volledige gelijkstand wordt alfabetisch gerangschikt.

## Werknemers
Geen Amcor-account nodig. De organisatie maakt in de adminpagina voor elke deelnemer een naam en unieke 4-cijferige code aan.

## Starten
```bash
npm install
ADMIN_PASSWORD="kies-een-sterk-wachtwoord" SESSION_SECRET="een-lange-willekeurige-string" npm start
```
Open daarna `http://localhost:3000`.

## QR-code
Maak na het online plaatsen een QR-code die rechtstreeks naar de publieke URL van `/` verwijst. De QR-code hoeft dus geen adminpagina of parameters te bevatten.

## Belangrijk voor productie
- Gebruik HTTPS.
- Stel een sterk `ADMIN_PASSWORD` en `SESSION_SECRET` in.
- Bewaar de database op persistente opslag.
- De huidige week gebruikt Belgische tijd (`Europe/Brussels`).
