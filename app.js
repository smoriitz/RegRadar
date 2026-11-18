// RegRadar: regulatory impact agent (static site, runs fully in the browser)
import Anthropic from "./vendor/anthropic-sdk.mjs";
import { AI_ACT, TESTS, DEMO } from "./data.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, persist) {
    try {
      sessionStorage.setItem(k, v);
      if (persist) localStorage.setItem(k, v); else localStorage.removeItem(k);
    } catch {}
  },
  del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} },
  pref(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} },
};

/* ------------------------------------------------------------------ */
/* Prompt + output schema                                              */
/* ------------------------------------------------------------------ */

const SYSTEM = `You are RegRadar, a senior regulatory impact analyst for banks.
TASK: Decide whether and how the REGULATION affects the specific BANK, using ONLY the regulation text provided by the user.

HARD RULES:
- Every provision, impact and action must cite the exact article/paragraph reference as it appears in the source (e.g. "Art. 26(2)", "Annex III 5(b)").
- For every provision, copy a short verbatim quote (max 30 words) from the regulation text that supports it. Copy it character for character; it is checked automatically against the source.
- If something is not covered by the source text, write exactly "Not in source". Never invent fines, deadlines, dates, thresholds or figures that are not in the source. Do not use outside knowledge of the regulation.
- Check exceptions and derogations carefully before concluding (e.g. carve-outs, "with the exception of", "by derogation", "notwithstanding").
- Determine the bank's role under the regulation from the source only (e.g. "Deployer"). If the profile suggests further roles whose obligations are not in the source, list them under not_in_source.
- If the bank is not affected: say so clearly, keep "functions" and "actions" empty, explain why in provisions, and list open questions that could change the verdict.
- If the verdict depends on facts missing from the bank profile, use "Partially affected" and name the missing facts in open_questions.
- If a specific question is asked, answer it directly in direct_answer. If the source does not contain the answer, say so and set ref to "Not in source". Otherwise leave answer and ref as empty strings.
- Be concise and concrete. Max 6 provisions, 5 functions, 7 actions, 4 open questions, exactly 3 exec_summary bullets.
- function must be one of: Risk, Compliance, IT, Data, Credit/Front Office, HR, Board.
- Order actions by priority (High first).`;

function userMessage(src, profile, q, lang) {
  return `<regulation>
${src}
</regulation>

<bank_profile>
${profile}
</bank_profile>

<specific_question>
${q || "(none)"}
</specific_question>

Write all free-text fields in ${lang}. Keep the verdict and priority values, the article references, the verbatim quotes and the phrase "Not in source" exactly as specified.`;
}

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "verdict_reason", "classification", "role", "provisions", "functions", "actions", "direct_answer", "not_in_source", "open_questions", "exec_summary"],
  properties: {
    verdict: { type: "string", enum: ["Affected", "Partially affected", "Not affected"] },
    verdict_reason: str,
    classification: str,
    role: str,
    provisions: { type: "array", items: { type: "object", additionalProperties: false, required: ["ref", "summary", "quote"], properties: { ref: str, summary: str, quote: str } } },
    functions: { type: "array", items: { type: "object", additionalProperties: false, required: ["function", "impact", "ref"], properties: { function: str, impact: str, ref: str } } },
    actions: { type: "array", items: { type: "object", additionalProperties: false, required: ["action", "owner", "priority", "ref"], properties: { action: str, owner: str, priority: { type: "string", enum: ["High", "Med", "Low"] }, ref: str } } },
    direct_answer: { type: "object", additionalProperties: false, required: ["answer", "ref"], properties: { answer: str, ref: str } },
    not_in_source: { type: "array", items: str },
    open_questions: { type: "array", items: str },
    exec_summary: { type: "array", items: str },
  },
};

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const settings = {
  get key() { return store.get("rr_key") || ""; },
  get model() { return $("model").value; },
  get lang() { return $("lang").value; },
};
$("model").value = store.pref("rr_model") || "claude-opus-5-5";
$("lang").value = store.pref("rr_lang") || "English";
$("apiKey").value = settings.key;
try { $("remember").checked = !!localStorage.getItem("rr_key"); } catch {}

function refreshMode() {
  const live = !!settings.key;
  $("modeBtn").classList.toggle("live", live);
  const short = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" }[settings.model];
  $("modeTxt").textContent = live ? `Live · ${short}` : "Demo mode";
}
$("modeBtn").onclick = () => $("settings").showModal();
$("settings").addEventListener("close", () => {
  const k = $("apiKey").value.trim();
  if (k) store.set("rr_key", k, $("remember").checked); else store.del("rr_key");
  store.pref("rr_model", $("model").value);
  store.pref("rr_lang", $("lang").value);
  refreshMode();
});
$("clearKey").onclick = () => { $("apiKey").value = ""; store.del("rr_key"); $("remember").checked = false; refreshMode(); };
refreshMode();

/* ------------------------------------------------------------------ */
/* Inputs + test cases                                                 */
/* ------------------------------------------------------------------ */

let current = 1;
$("tests").innerHTML = Object.entries(TESTS).map(([n, t]) =>
  `<button class="tbtn" data-t="${n}"><b>${n} · ${esc(t.name)}</b>${esc(t.sub)}</button>`).join("");
function loadTest(n) {
  current = n;
  document.querySelectorAll(".tbtn").forEach((b) => b.classList.toggle("on", +b.dataset.t === n));
  $("src").value = AI_ACT; $("profile").value = TESTS[n].profile; $("question").value = TESTS[n].q;
  srcInfo();
}
document.querySelectorAll(".tbtn").forEach((b) => (b.onclick = () => loadTest(+b.dataset.t)));
function srcInfo() {
  const v = $("src").value;
  const words = v.trim() ? v.trim().split(/\s+/).length : 0;
  $("srcInfo").textContent = (v === AI_ACT ? "EU AI Act (Reg. 2024/1689), condensed excerpt · " : "Custom text · ") + words.toLocaleString() + " words";
}
$("src").addEventListener("input", srcInfo);
$("file").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $("src").value = await f.text(); srcInfo(); e.target.value = "";
  document.querySelectorAll(".tbtn").forEach((b) => b.classList.remove("on"));
};
loadTest(1);

/* ------------------------------------------------------------------ */
/* Claude call                                                         */
/* ------------------------------------------------------------------ */

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

async function callClaude({ src, profile, q }) {
  const client = new Anthropic({ apiKey: settings.key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const model = settings.model;
  const base = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage(src, profile, q, settings.lang) }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
  };
  // Server-side refusal fallback for Opus/Sonnet (Haiku has none).
  const useFallback = model !== "claude-haiku-5-5";
  let res;
  try {
    res = useFallback
      ? await client.beta.messages.create({ ...base, betas: [FALLBACK_BETA], fallbacks: "default" })
      : await client.messages.create(base);
  } catch (e) {
    if (useFallback && e?.status === 400 && /fallback/i.test(e.message || "")) res = await client.messages.create(base);
    else throw e;
  }
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request" + (res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "."));
  if (res.stop_reason === "max_tokens") throw new Error("The answer was cut off (max_tokens). Try a shorter regulation text.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: parseJSON(text), model: res.model, usage: res.usage };
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("No JSON in response");
  return JSON.parse(text.slice(a, b + 1));
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Invalid API key. Open ⚙ settings and check your key.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key has no access to the selected model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limit reached. Wait a moment and try again.";
  if (e instanceof Anthropic.BadRequestError) return "Request rejected: " + (e.message || "bad request");
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach api.anthropic.com. Check your network connection.";
  if (e instanceof Anthropic.APIError) return `API error (${e.status ?? "?"}): ${e.message}`;
  return e?.message || String(e);
}

/* One analysis run: live with a key, otherwise the pre-computed demo result. */
async function analyse(input, testId) {
  const t0 = performance.now();
  if (settings.key) {
    const r = await callClaude(input);
    return { ...r, secs: (performance.now() - t0) / 1000, demo: false };
  }
  const t = TESTS[testId];
  const unchanged = t && input.src === AI_ACT && input.profile === t.profile && input.q === t.q;
  if (!unchanged) {
    const err = new Error("Demo mode only covers the three unchanged test cases. Add an Anthropic API key in ⚙ settings to analyse your own text.");
    err.needsKey = true; throw err;
  }
  await new Promise((r) => setTimeout(r, 2200 + Math.random() * 900));
  return { data: structuredClone(DEMO[testId]), secs: (performance.now() - t0) / 1000, demo: true, model: "pre-computed reference" };
}

/* ------------------------------------------------------------------ */
/* Grounding checks                                                    */
/* ------------------------------------------------------------------ */

const norm = (s) => String(s || "").toLowerCase().replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const isNIS = (r) => /not in source/i.test(r || "");
function quoteOk(quote, src) {
  const q = norm(quote).replace(/^[."'…\s]+|[."'…\s]+$/g, "");
  return q.length > 3 && norm(src).includes(q);
}
function refKey(ref) {
  const m = String(ref || "").match(/(\d+)\s*\(\s*([0-9a-z]+)\s*\)/i);
  if (m) return `${m[1]}(${m[2].toLowerCase()})`;
  const a = String(ref || "").match(/(?:art(?:icle)?\.?\s*)(\d+)/i);
  return a ? `Article ${a[1]}` : null;
}
function refFound(ref, src) {
  if (!ref || isNIS(ref)) return true;
  const k = refKey(ref);
  if (!k) return norm(src).includes(norm(ref));
  return src.includes(k); // e.g. "5(b)", "26(2)" or "Article 27"
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function refChip(r, src) {
  r = r || "";
  if (!r) return "";
  if (isNIS(r)) return `<span class="ref nis">${esc(r)}</span>`;
  const ok = refFound(r, src);
  return `<span class="ref ${ok ? "" : "bad"}" data-ref="${esc(r)}" title="${ok ? "Show in source" : "Reference not found in the source text"}">${esc(r)}${ok ? "" : " ⚠"}</span>`;
}

let lastRun = null;
function render(run, src) {
  const d = run.data;
  d.provisions = (d.provisions || []).slice(0, 6);
  d.functions = (d.functions || []).slice(0, 5);
  d.actions = (d.actions || []).slice(0, 7);
  const v = (d.verdict || "").toLowerCase();
  const cls = v.startsWith("not") ? "v-not" : v.startsWith("partial") ? "v-part" : "v-aff";
  const verified = d.provisions.filter((p) => quoteOk(p.quote, src)).length;
  const R = (r) => refChip(r, src);

  let h = `<div class="toolbar">
      <button class="sbtn" id="copyMd">Copy as Markdown</button>
      <button class="sbtn" id="dlMd">Download .md</button>
      <button class="sbtn" id="print">Print / PDF</button>
    </div>
    <div class="verdict ${cls}"><span class="tag">${esc(d.verdict)}</span><div><h2>${esc(d.classification)}</h2><p>${esc(d.verdict_reason)}</p></div></div>
    <div class="meta">
      ${run.demo ? `<span class="pill demo" title="No API key set: this is the stored reference result for this test case">Demo result (pre-computed)</span>` : `<span class="pill">Model: <b>${esc(run.model)}</b></span>`}
      <span class="pill">Role: <b>${esc(d.role || "n/a")}</b></span>
      <span class="pill">Time: <b>${run.secs.toFixed(1)} s</b></span>
      <span class="pill">Quotes verified: <b class="${verified === d.provisions.length ? "ok" : "no"}">${verified}/${d.provisions.length}</b></span>
    </div>`;
  if (d.exec_summary?.length) h += `<div class="sec"><h3>Executive summary</h3><div class="exec"><ul class="clean">${d.exec_summary.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>`;
  if (d.direct_answer?.answer) h += `<div class="sec"><h3>Your question</h3><div class="direct">${esc(d.direct_answer.answer)} ${R(d.direct_answer.ref)}</div></div>`;
  if (d.provisions.length) h += `<div class="sec"><h3>Relevant provisions</h3><div class="tbl-wrap"><table>${d.provisions.map((p) => {
    const ok = quoteOk(p.quote, src);
    return `<tr><td style="width:130px">${R(p.ref)}</td><td>${esc(p.summary)}${p.quote ? `<span class="quote" data-quote="${esc(p.quote)}" data-ref="${esc(p.ref)}" title="Show in source">“${esc(p.quote)}”<span class="vchk ${ok ? "ok" : "no"}">${ok ? "✓ verbatim in source" : "⚠ not found verbatim"}</span></span>` : ""}</td></tr>`;
  }).join("")}</table></div></div>`;
  if (d.functions.length) h += `<div class="sec"><h3>Impacted functions</h3><div class="fn">${d.functions.map((f) => `<div><b>${esc(f.function)}</b>${esc(f.impact)}<br>${R(f.ref)}</div>`).join("")}</div></div>`;
  if (d.actions.length) h += `<div class="sec"><h3>Action plan</h3><div class="tbl-wrap"><table><tr><th>#</th><th>Action</th><th>Owner</th><th>Prio</th><th>Source</th></tr>${d.actions.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.action)}</td><td>${esc(a.owner)}</td><td><span class="prio p-${esc(a.priority)}">${esc(a.priority)}</span></td><td>${R(a.ref)}</td></tr>`).join("")}</table></div></div>`;
  if (d.not_in_source?.length) h += `<div class="sec"><h3>Not in source</h3><ul class="clean">${d.not_in_source.map((x) => `<li>${esc(x)} <span class="ref nis">Not in source</span></li>`).join("")}</ul></div>`;
  if (d.open_questions?.length) h += `<div class="sec"><h3>Open questions for the client workshop</h3><ul class="clean">${d.open_questions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;

  show("result"); $("result").innerHTML = h;
  $("kTime").textContent = run.secs.toFixed(0) + " s";
  $("kRefs").textContent = d.provisions.length;
  $("kVer").textContent = `${verified}/${d.provisions.length}`;
  $("kActs").textContent = d.actions.length;
  lastRun = run;

  $("copyMd").onclick = async () => {
    try { await navigator.clipboard.writeText(asMarkdown(d)); flash($("copyMd"), "Copied ✓"); } catch { flash($("copyMd"), "Copy blocked"); }
  };
  $("dlMd").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([asMarkdown(d)], { type: "text/markdown" }));
    a.download = `regradar-${(d.verdict || "result").toLowerCase().replace(/\s+/g, "-")}.md`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("print").onclick = () => window.print();
  $("result").querySelectorAll(".ref[data-ref]").forEach((c) => (c.onclick = () => highlight(c.dataset.ref)));
  $("result").querySelectorAll(".quote").forEach((c) => (c.onclick = () => highlight(c.dataset.ref, c.dataset.quote)));
}
function flash(btn, txt) { const o = btn.textContent; btn.textContent = txt; setTimeout(() => (btn.textContent = o), 1600); }

function asMarkdown(d) {
  const L = [];
  L.push(`# RegRadar: ${d.verdict}`, "", `**${d.classification}** · Role: ${d.role}`, "", d.verdict_reason, "", "## Executive summary");
  (d.exec_summary || []).forEach((x) => L.push(`- ${x}`));
  if (d.direct_answer?.answer) L.push("", "## Your question", `${d.direct_answer.answer} [${d.direct_answer.ref}]`);
  L.push("", "## Relevant provisions");
  (d.provisions || []).forEach((p) => L.push(`- **${p.ref}**: ${p.summary}${p.quote ? `\n  > "${p.quote}"` : ""}`));
  if (d.functions?.length) { L.push("", "## Impacted functions"); d.functions.forEach((f) => L.push(`- **${f.function}**: ${f.impact} [${f.ref}]`)); }
  if (d.actions?.length) {
    L.push("", "## Action plan", "", "| # | Action | Owner | Prio | Source |", "|---|---|---|---|---|");
    d.actions.forEach((a, i) => L.push(`| ${i + 1} | ${a.action.replace(/\|/g, "/")} | ${a.owner} | ${a.priority} | ${a.ref} |`));
  }
  if (d.not_in_source?.length) { L.push("", "## Not in source"); d.not_in_source.forEach((x) => L.push(`- ${x}`)); }
  if (d.open_questions?.length) { L.push("", "## Open questions"); d.open_questions.forEach((x) => L.push(`- ${x}`)); }
  L.push("", "---", "_Generated with RegRadar. Grounded only in the provided regulation text; verify against the official text._");
  return L.join("\n");
}

/* Jump to the cited passage in the regulation textarea. */
function highlight(ref, quote) {
  const ta = $("src"), txt = ta.value;
  let start = -1, end = -1;
  if (quote) {
    start = txt.indexOf(quote.trim());
    if (start < 0) start = txt.toLowerCase().indexOf(quote.trim().toLowerCase());
    if (start >= 0) end = start + quote.trim().length;
  }
  if (start < 0) {
    const k = refKey(ref); if (!k) return;
    start = txt.indexOf("\n" + k);
    if (start < 0) start = txt.indexOf(k); else start += 1;
    if (start < 0) return;
    end = txt.indexOf("\n", start); if (end < 0) end = txt.length;
  }
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  // Estimate the visual line, accounting for wrapped lines.
  const charsPerLine = Math.max(20, Math.floor(ta.clientWidth / 7));
  const visualLine = txt.slice(0, start).split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / charsPerLine)), 0) - 1;
  ta.scrollIntoView({ behavior: "smooth", block: "center" });
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  ta.scrollTop = Math.max(0, (visualLine - 2) * lh);
}

/* ------------------------------------------------------------------ */
/* Loading state                                                       */
/* ------------------------------------------------------------------ */

let stepTimer, clock;
function show(which) { ["empty", "loading", "bench", "result"].forEach((id) => ($(id).hidden = id !== which)); }
function startLoading(label) {
  show("loading"); $("err").style.display = "none";
  const lis = [...$("steps").children]; lis.forEach((l) => (l.className = "")); lis[0].className = "act";
  let i = 0; const t0 = performance.now();
  clock = setInterval(() => ($("timer").textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s" + (label ? ` · ${label}` : "")), 100);
  const every = settings.key ? 3500 : 500;
  stepTimer = setInterval(() => { if (i < lis.length - 1) { lis[i].className = "done"; lis[++i].className = "act"; } }, every);
}
function stopLoading() { clearInterval(stepTimer); clearInterval(clock); }
function showErr(html) { $("err").innerHTML = html; $("err").style.display = "block"; }

function busy(on) {
  $("go").disabled = on; $("benchBtn").disabled = on;
  $("go").textContent = on ? "◎ Scanning…" : "◎ Run impact analysis";
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function run() {
  const input = { src: $("src").value.trim(), profile: $("profile").value.trim(), q: $("question").value.trim() };
  if (!input.src || !input.profile) { showErr("Please provide regulation text and a bank profile."); return; }
  // compare against untrimmed originals for demo matching
  const raw = { src: $("src").value, profile: $("profile").value, q: $("question").value };
  const testId = document.querySelector(".tbtn.on") ? current : null;
  busy(true); startLoading();
  try {
    const r = await analyse(settings.key ? input : raw, testId);
    stopLoading();
    if (!r.demo) try { localStorage.setItem("rr_last", JSON.stringify({ r, src: input.src })); } catch {}
    render(r, input.src);
  } catch (e) {
    stopLoading();
    show(lastRun ? "result" : "empty");
    if (e.needsKey) { showErr(esc(e.message) + ` <br><button class="sbtn" id="openSet">Open settings</button>`); $("openSet").onclick = () => $("settings").showModal(); }
    else {
      let backup = null; try { backup = JSON.parse(localStorage.getItem("rr_last")); } catch {}
      showErr("Analysis failed: " + esc(friendlyError(e)) + (backup ? ` <br><button class="sbtn" id="bk">Show last successful run</button>` : ""));
      if (backup) $("bk").onclick = () => { render(backup.r, backup.src); $("err").style.display = "none"; };
    }
  } finally { busy(false); }
}
$("go").onclick = run;
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("go").disabled) run(); });

/* ------------------------------------------------------------------ */
/* Benchmark: the three test cases with expected outcomes              */
/* ------------------------------------------------------------------ */

const FIGURE = /(€|eur)\s?\d|\d[\d.,]*\s?(million|mio|%|percent)|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d\d|\b20\d\d-\d\d-\d\d/i;

function checkCase(id, d) {
  const e = TESTS[id].expect, checks = [];
  const refList = [...(d.provisions || []), ...(d.functions || []), ...(d.actions || []), d.direct_answer || {}].map((x) => x.ref || "").filter(Boolean);
  const refs = refList.join(" ");
  checks.push([`Verdict is "${e.verdict}"`, d.verdict === e.verdict, d.verdict]);
  e.mustCite.forEach((r) => checks.push([`Cites ${r}`, refs.includes(r)]));
  const q = (d.provisions || []).filter((p) => p.quote);
  checks.push(["All quotes verbatim in source", q.length > 0 && q.every((p) => quoteOk(p.quote, AI_ACT)), `${q.filter((p) => quoteOk(p.quote, AI_ACT)).length}/${q.length}`]);
  checks.push(["All references exist in source", refList.every((r) => refFound(r, AI_ACT))]);
  if (e.actionsEmpty) checks.push(["No functions / actions", !(d.functions || []).length && !(d.actions || []).length]);
  else checks.push(["Action plan present", (d.actions || []).length > 0]);
  if (e.noInventedFigures) {
    const da = d.direct_answer || {};
    checks.push(["Question answered with \"Not in source\"", isNIS(da.ref) || /not (stated|contained|included|in the)|nicht/i.test(da.answer || "")]);
    checks.push(["No invented fines or dates", !FIGURE.test(`${da.answer} ${(d.exec_summary || []).join(" ")}`)]);
  }
  checks.push(["Exactly 3 exec bullets", (d.exec_summary || []).length === 3]);
  return checks;
}

async function benchmark() {
  busy(true); startLoading("benchmark: 3 cases");
  const ids = Object.keys(TESTS).map(Number);
  const results = await Promise.all(ids.map(async (id) => {
    const t = TESTS[id];
    try { return { id, ...(await analyse({ src: AI_ACT, profile: t.profile, q: t.q }, id)) }; }
    catch (e) { return { id, error: friendlyError(e) }; }
  }));
  stopLoading(); busy(false);
  let pass = 0, total = 0;
  const cards = results.map((r) => {
    const t = TESTS[r.id];
    if (r.error) { total++; return `<div class="fn"><div><b>${r.id} · ${esc(t.name)}</b><span class="no">✗ ${esc(r.error)}</span></div></div>`; }
    const c = checkCase(r.id, r.data); const p = c.filter((x) => x[1]).length; pass += p; total += c.length;
    return `<tr><td><b>${r.id} · ${esc(t.name)}</b><br><span class="muted small">${esc(t.sub)}</span><br><button class="sbtn" data-open="${r.id}" style="margin-top:6px">Open result</button></td>
      <td><b class="${p === c.length ? "ok" : "no"}">${p}/${c.length}</b> · ${r.secs.toFixed(1)} s</td>
      <td><ul class="chks">${c.map(([n, ok, info]) => `<li class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} <span style="color:var(--text)">${esc(n)}</span>${info ? ` <span class="muted">(${esc(info)})</span>` : ""}</li>`).join("")}</ul></td></tr>`;
  });
  const anyDemo = results.some((r) => r.demo);
  show("bench");
  $("bench").innerHTML = `<div class="bench"><h3>Benchmark · three test cases</h3>
    <div class="score">${pass}/${total} checks passed</div>
    <p class="muted small">${anyDemo ? "Demo mode: checks run against the pre-computed reference results. Add an API key to benchmark Claude live." : `Live run on ${esc(settings.model)}.`} Checks: expected verdict, required citations, verbatim quotes, no invented fines or dates.</p>
    <div class="tbl-wrap"><table><tr><th>Case</th><th>Score</th><th>Checks</th></tr>${cards.join("")}</table></div></div>`;
  $("bench").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => {
    const r = results.find((x) => x.id === +b.dataset.open); loadTest(r.id); render(r, AI_ACT);
  }));
  $("kTime").textContent = Math.max(...results.map((r) => r.secs || 0)).toFixed(0) + " s";
}
$("benchBtn").onclick = benchmark;
