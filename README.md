# RegRadar Agent

**Betrifft uns diese Regulierung, und was müssen wir tun?**
RegRadar ist ein autonomer Agent für Banken. Er bekommt einen Regulierungstext (z. B. den EU AI Act) und ein Bankprofil, arbeitet sich mit Werkzeugen selbst durch den Text und liefert ein Urteil, betroffene Funktionen und einen Maßnahmenplan. Jede Aussage trägt ihre Artikelreferenz, und jedes Zitat wird geprüft.

Gebaut für die zeb Agent League.

## Autopilot (index.html, ohne API-Key)

`index.html` ist der RegRadar Autopilot: Er analysiert und legt danach Tasks, Register-Eintrag, E-Mail und Termin zur Freigabe an. Für die drei Demo-Testfälle sind die Agent-Läufe vorab berechnet und werden live abgespielt, damit die Demo ohne API-Key funktioniert. Texte zum Einfügen: `demo/RegRadar_Demo-Texte.txt`, Pitch: `demo/Pitch.md`. Die Live-Agent-Version liegt unter `agent.html`.

## Wie der Agent arbeitet

Der Agent sieht Regulierung und Bankprofil nicht direkt, sondern nur über Werkzeuge, die im Browser laufen:

| Werkzeug | Was es tut |
|---|---|
| `get_bank_profile` | liest das Bankprofil |
| `list_provisions` | Inhaltsverzeichnis der Regulierung (Artikel, Absätze, Annex-Punkte werden automatisch erkannt) |
| `search_regulation` | Stichwortsuche mit Textausschnitten |
| `read_provisions` | Volltext einzelner Vorschriften |
| `verify_citations` | prüft, ob ein Zitat wörtlich in der genannten Vorschrift steht |

Ablauf: Profil und Inhaltsverzeichnis lesen → relevante Vorschriften inkl. Ausnahmen lesen → Urteil bilden → alle Zitate verifizieren → Ergebnis abgeben. Jeder Schritt erscheint live im **Agent-Trace**. Im API-Modus prüft die App die Abgabe zusätzlich und schickt sie bei falschen Zitaten oder Referenzen zur Korrektur zurück.

## Zwei Wege, die App zu nutzen

**1. Auf claude.ai (ohne API-Key, für den Pitch):**
https://claude.ai/artifact/TePLWdDgv2ZzG5sgEz6nhe
Der Agent läuft über den Claude-Account der Person, die die Seite öffnet. Beim ersten Lauf fragt claude.ai einmal, ob die Seite Claude nutzen darf. Das Artifact ist zunächst privat: Zum Teilen oben auf der Seite **Share** verwenden.

**2. Auf GitHub Pages (mit eigenem API-Key):**
Ohne `window.claude` braucht die Seite einen Anthropic API-Key (⚙ oben rechts). Der Key bleibt im Browser und geht nur an `api.anthropic.com`. Ohne Key verweist die Seite auf die claude.ai-Version.

## Demo-Texte

`demo/RegRadar_Demo-Texte.docx` enthält den AI-Act-Auszug und die drei Testfälle zum manuellen Einfügen im Pitch:

| # | Fall | Erwartung |
|---|---|---|
| 1 | Regionalbank mit ML-Kreditscoring | **Affected**: High-risk nach Annex III 5(b), FRIA nach Art. 27(1) |
| 2 | Verwahrbank, keine Kredite, nur Fraud-KI | **Not affected**: Fraud-Ausnahme in Annex III 5(b) |
| 3 | Edge Case: Frage nach Bußgeld und Stichtag | **Affected**, Antwort *Not in source* (nichts erfunden) |

## GitHub Pages einrichten

1. Branch nach `main` mergen.
2. **Settings → Pages → Deploy from a branch**, Branch `main`, Ordner `/ (root)`.
3. Nach ca. 1 Minute: `https://<user>.github.io/RegRadar/`

> ⚠️ Niemals einen API-Key ins Repository committen.

## Lokal starten

```bash
python3 -m http.server 8000
```

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css` | Seite und Design |
| `app.js` | Agent-Prompt, Werkzeuge, beide Engines (claude.ai und API), Zitat-Check, Rendering |
| `tools/build-artifact.py` | baut daraus die Ein-Datei-Version für claude.ai (`dist/regradar-artifact.html`) |
| `demo/RegRadar_Demo-Texte.docx` | Demo-Texte für den Pitch |
| `vendor/anthropic-sdk.mjs` | gebündeltes offizielles Anthropic SDK (v1.4.0, MIT), nur für den API-Modus |

Nach Änderungen an `index.html`, `styles.css` oder `app.js`: `python3 tools/build-artifact.py` ausführen und `dist/regradar-artifact.html` erneut als Artifact veröffentlichen.

## Hinweis

Ergebnisse immer gegen den offiziellen Text auf EUR-Lex prüfen. Keine Rechtsberatung.
