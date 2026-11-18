#!/usr/bin/env python3
"""Build the single-file claude.ai artifact version of RegRadar.

Inlines styles.css and app.js into the body of index.html and writes
dist/regradar-artifact.html (the claude.ai publish skeleton adds <html>/<head>).
"""
import pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "agent.html").read_text()
css = (root / "styles.css").read_text()
js = (root / "app.js").read_text()

title = re.search(r"<title>.*?</title>", html, re.S).group(0)
fonts = "\n".join(re.findall(r'<link[^>]*https://fonts\.g[^>]*>', html))
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = body.replace('<script type="module" src="app.js"></script>', f'<script type="module">\n{js}\n</script>')

out = root / "dist" / "regradar-artifact.html"
out.parent.mkdir(exist_ok=True)
out.write_text(f'{title}\n{fonts}\n<style>\n{css}\n</style>\n{body.strip()}\n')
print(f"wrote {out.relative_to(root)} ({out.stat().st_size // 1024} KB)")
