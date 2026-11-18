# RegRadar Autopilot: Pitch (ca. 3 Minuten)

## 1. Problem (30 s)
Jedes Jahr kommen für Banken Dutzende neue Regulierungen: AI Act, DORA, Basel-Updates. Heute liest ein Compliance-Team jeden Text manuell, prüft, ob die Bank betroffen ist, und verteilt dann per E-Mail Aufgaben. Das dauert Tage bis Wochen, und gerade Ausnahmen werden leicht übersehen.

## 2. Lösung (30 s)
RegRadar ist ein KI-Agent für Compliance-Teams in Banken und für die Berater, die sie unterstützen. Er beantwortet zwei Fragen: **Betrifft uns diese Regulierung, und was müssen wir tun?**
Der Agent liest die Regulierung nicht einfach, sondern arbeitet sie wie ein Analyst ab: Bankprofil lesen, Text durchsuchen, relevante Artikel samt Ausnahmen lesen, jedes Zitat prüfen. Danach handelt er: Er legt Tickets an, trägt das Ergebnis ins Compliance-Register ein, schreibt die E-Mail an den Head of Compliance und bucht den Kickoff-Workshop.

## 3. Live-Demo (90 s)
**Testfall 1, Regionalbank mit Kreditscoring:**
- Text und Profil einfügen, „Run agent“ klicken.
- Auf den Trace zeigen: „Hier sieht man jeden Schritt des Agenten: suchen, lesen, Zitate verifizieren.“
- Ergebnis: **Affected**, Hochrisiko-KI nach Annex III 5(b). Jede Aussage hat eine Artikelreferenz. Ein Klick darauf markiert die Stelle im Originaltext.
- Unten: Tasks, Register, E-Mail und Termin stehen bereit. „Nichts passiert ohne Freigabe: Vier-Augen-Prinzip.“ Dann **Approve all** klicken.

**Testfall 2, Verwahrbank:**
- „Gleiche Regulierung, andere Bank.“ Ergebnis: **Not affected**, weil Betrugserkennung in Annex III 5(b) ausdrücklich ausgenommen ist. „Der Agent prüft Ausnahmen und schlägt keinen Fehlalarm.“

**Testfall 3, Frage nach Bußgeld und Stichtag:**
- Ergebnis: **Not in source**. „Der Auszug enthält keine Bußgelder und keine Fristen, also erfindet der Agent auch keine. In der Compliance ist eine falsche Zahl schlimmer als keine Zahl.“

## 4. Nutzen (20 s)
- Von Tagen auf Minuten: Erstanalyse und Maßnahmenplan direkt nach Veröffentlichung.
- Nachvollziehbar: Jede Aussage ist zitiert und gegen den Originaltext geprüft.
- Sicher: Der Agent bereitet Aktionen vor, der Mensch gibt sie frei.

## 5. Abschluss (10 s)
„RegRadar macht aus einer neuen Regulierung in Minuten einen geprüften, zitierten und freigabebereiten Maßnahmenplan. Nächster Schritt: Anbindung an echte Systeme wie Jira, Outlook und das Compliance-Register der Bank.“

---
**Falls gefragt wird:** Für die Demo sind die drei Testfälle vorab berechnet, damit sie ohne API-Key stabil laufen. Mit API-Key oder auf claude.ai läuft der Agent live (`agent.html` bzw. die claude.ai-Version).
