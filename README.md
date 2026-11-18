# RegRadar: Regulatory Impact Agent

**Betrifft uns diese Regulierung, und was müssen wir tun?**
RegRadar liest einen Regulierungstext (z. B. den EU AI Act), gleicht ihn mit einem Bankprofil ab und liefert ein Urteil, betroffene Funktionen und einen Maßnahmenplan. Jede Aussage trägt ihre Artikelreferenz, und jedes Zitat wird automatisch gegen den Quelltext geprüft.

Gebaut für die zeb Agent League (Domäne: Own idea / Knowledge management).

## Features

- **Gegroundet:** Claude nutzt nur den eingefügten Text. Was fehlt, wird als *Not in source* markiert (keine erfundenen Bußgelder oder Fristen).
- **Zitat-Check:** Jede Provision enthält ein wörtliches Zitat, das im Browser gegen die Quelle geprüft wird (✓ / ⚠). Ein Klick auf eine Referenz oder ein Zitat springt zur Stelle im Text.
- **Benchmark:** `▶ Run benchmark` führt die drei Testfälle aus und prüft sie automatisch (Urteil, Pflichtzitate, wörtliche Zitate, keine erfundenen Zahlen).
- **Demo-Modus ohne API-Key:** Vorberechnete Referenzergebnisse für die drei Testfälle, damit der Pitch auch ohne Internet oder Key läuft.
- **Live-Modus:** Mit eigenem Anthropic API-Key über Claude Opus 5.5, Sonnet 5.5 oder Haiku 5.5, mit garantiert gültigem JSON (Structured Outputs).
- Ausgabe auf Englisch oder Deutsch, Export als Markdown oder PDF, eigene Texte als `.txt`/`.md` laden.

## Testfälle

| # | Fall | Erwartung |
|---|---|---|
| 1 | Regionalbank mit ML-Kreditscoring | **Affected**: High-risk nach Annex III 5(b), FRIA nach Art. 27(1) |
| 2 | Verwahrbank, keine Kredite, nur Fraud-KI | **Not affected**: Fraud-Ausnahme in Annex III 5(b) |
| 3 | Edge Case: Frage nach Bußgeld und Stichtag | **Affected**, Antwort: *Not in source* (nichts erfunden) |

## Auf GitHub Pages veröffentlichen

1. Branch nach `main` mergen (oder den Branch direkt als Quelle wählen).
2. Im Repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Branch `main`, Ordner `/ (root)` wählen und speichern.
4. Nach ca. 1 Minute ist die Seite unter `https://<user>.github.io/RegRadar/` erreichbar.

Es gibt keinen Build-Schritt. Die Seite besteht nur aus statischen Dateien.

## Live-Modus nutzen

1. API-Key unter [platform.claude.com](https://platform.claude.com) erstellen.
2. Auf der Seite oben rechts auf **⚙ Demo mode** klicken, den Key eintragen und speichern.
3. Der Key bleibt im Browser (Session oder optional localStorage) und geht nur an `api.anthropic.com`.

> ⚠️ **Niemals einen API-Key ins Repository committen.** Die Seite ist öffentlich. Für Live-Demos am besten einen eigenen Key mit niedrigem Ausgabelimit verwenden.

## Lokal starten

```bash
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen. Wegen der ES-Module funktioniert ein direktes Öffnen per `file://` nicht.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur |
| `styles.css` | Design (inkl. Print-Layout) |
| `app.js` | Prompt, JSON-Schema, Claude-Aufruf, Zitat-Check, Rendering, Benchmark |
| `data.js` | AI-Act-Auszug, Testfälle mit Erwartungen, Demo-Ergebnisse |
| `vendor/anthropic-sdk.mjs` | Gebündeltes offizielles Anthropic TypeScript SDK (v1.4.0, MIT) |

## Hinweis

Der Regulierungsauszug ist für Demozwecke gekürzt. Prüft alles gegen den offiziellen Text auf EUR-Lex. Das hier ist keine Rechtsberatung.
