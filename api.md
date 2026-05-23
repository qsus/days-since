# Counters API

Událostní počítadla s SQLite persistencí a dynamickým výpočtem stáří.

## Datový model
```
{
  "name": "fire",
  "description": "Počet dní od posledního požáru",
  "info": "23. 05. hořela Džungle.",
  "timestamp": 1716477345,
  "precision": "day",
  "timesince": 86400
}
```
*(Vlastnost `timesince` je počítaná dynamicky na serveru).*

## Autentizace (HTTP Basic)
* **Setup:** `flask --app app set-password <heslo>`
* **Použití:** Předává se pouze heslo, username se ignoruje (např. `curl -u :<heslo>`).

## Endpointy

### Public (GET)
* `/counters` – Vrací pole (list) všech objektů.
* `/counter/<name>` – Detail počítadla.
* `/counter/<name>/<property>` – Konkrétní klíč (např. `{"timesince": 123}`).

### Admin (Vyžadují Basic Auth)
* **`PUT`** `/counter/<name>` – Upsert (vytvoří nebo updatuje). Přijímá partial JSON payload. Pokud při zakládání chybí `timestamp`, vloží se aktuální čas.
* **`POST`** `/counter/<name>/reset` – Přepíše `timestamp` záznamu na `now()`.
* **`POST`** `/lockout` – Bezpečnostní kill-switch. Vynuluje soubor `.password` a trvale zablokuje admin endpointy (403), dokud se přes CLI nevygeneruje nové heslo.
