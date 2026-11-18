// RegRadar Agent: autonomous regulatory impact agent (runs fully in the browser)
//
// Two engines, same agent and tools:
//  1. claude.ai: when the page runs as a claude.ai artifact, Claude is called via
//     window.claude.use("sample") on the viewer's own Claude account. No API key.
//  2. Anthropic API: anywhere else (e.g. GitHub Pages) with the user's own API key,
//     using the official SDK and a manual tool-use loop.

// Link to the claude.ai version of this page (shown on GitHub Pages when no key is set).
const CLAUDE_URL = "https://claude.ai/artifact/TePLWdDgv2ZzG5sgEz6nhe";

const $ = (id) => document.getElementById(id);
const IN_CLAUDE = !!window.claude?.use;
const samplePromise = IN_CLAUDE ? window.claude.use("sample").catch(() => null) : Promise.resolve(null);

const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, persist) { try { sessionStorage.setItem(k, v); if (persist) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} },
  pref(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} },
};

/* ------------------------------------------------------------------ */
/* Agent instructions + answer schema                                  */
/* ------------------------------------------------------------------ */

const FINAL_SHAPE = `{
 "verdict": "Affected" | "Partially affected" | "Not affected",
 "verdict_reason": "one sentence",
 "classification": "short label, e.g. 'High-risk AI system (Annex III 5(b))' or 'Out of scope'",
 "role": "the bank's role under the regulation, or 'Not in source'",
 "provisions": [{"ref": "...", "summary": "plain-language, one line", "quote": "exact phrase you verified with verify_citations"}],
 "functions": [{"function": "Risk | Compliance | IT | Data | Credit/Front Office | HR | Board", "impact": "what changes", "ref": "..."}],
 "actions": [{"action": "concrete action", "owner": "function", "priority": "High" | "Med" | "Low", "ref": "..."}],
 "direct_answer": {"answer": "answer to the SPECIFIC QUESTION, or empty string if none", "ref": "reference or 'Not in source'"},
 "not_in_source": ["facts the analysis needed but the source does not contain"],
 "open_questions": ["questions for the client workshop"],
 "exec_summary": ["bullet 1", "bullet 2", "bullet 3"]
}`;

function agentPrompt(q, lang, finish) {
  return `You are RegRadar, an autonomous regulatory impact AGENT for banks.
GOAL: Decide whether and how a regulation affects a specific bank, and produce a cited impact analysis.

You do NOT see the regulation or the bank profile directly. You must use your tools:
- get_bank_profile(): read the bank profile.
- list_provisions(): table of contents of the regulation (references + headings).
- search_regulation(query): keyword search, returns matching provisions with snippets.
- read_provisions(refs): full text of one or more provisions.
- verify_citations(citations): checks for each {ref, evidence} that the exact phrase appears in that provision.

WORK PLAN. You have only a few tool rounds, so call SEVERAL tools in parallel in each round:
1. Round 1: call get_bank_profile AND list_provisions together.
2. Round 2: read_provisions for every provision that could apply, in one call, including exceptions and derogations ("with the exception of", "by derogation", "notwithstanding", "shall not"). Add search_regulation calls in the same round if the table of contents is not enough.
3. Decide the verdict.
4. Round 3: one verify_citations call covering EVERY provision you will cite (evidence = a short exact phrase copied from that provision, max 30 words). Drop or fix any citation that fails.
5. ${finish}

HARD RULES:
- Only facts from the tools. If something is not covered, write "Not in source". Never invent fines, deadlines, dates, thresholds or figures, and do not use outside knowledge of the regulation.
- Cite references exactly as the tools return them.
- Each provision's "quote" must be the evidence phrase that verify_citations confirmed.
- If the bank is not affected: say so clearly, keep "functions" and "actions" empty, explain why in provisions, and list open questions that could change the verdict.
- If the verdict depends on facts missing from the bank profile, use "Partially affected" and name the missing facts in open_questions.
- Max 6 provisions, 5 functions, 7 actions, 4 open questions, exactly 3 exec_summary bullets. Order actions by priority (High first).
- Write all free-text fields in ${lang}. Keep verdict and priority values, references, quotes and the phrase "Not in source" exactly as specified.

FINAL ANSWER SHAPE:
${FINAL_SHAPE}

SPECIFIC QUESTION FROM THE USER: ${q || "(none)"}

Start now with round 1.`;
}

const str = { type: "string" };
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["verdict", "verdict_reason", "classification", "role", "provisions", "functions", "actions", "direct_answer", "not_in_source", "open_questions", "exec_summary"],
  properties: {
    verdict: { type: "string", enum: ["Affected", "Partially affected", "Not affected"] },
    verdict_reason: str, classification: str, role: str,
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
/* Regulation parsing                                                  */
/* ------------------------------------------------------------------ */

// Splits pasted regulation text into addressable provisions. Understands the
// condensed style ("26(2) Deployers shall ..."), the official EUR-Lex layout
// ("Article 26" / "2. Deployers shall ..."; "ANNEX III" / "5. ..." / "(b) ...")
// and German "§ 25a" / "(1) ..." style. Unstructured text falls back to paragraphs.
function parseProvisions(text) {
  const out = []; let cur = null;
  let kind = null, num = "", annexPoint = "", wantHeading = null;
  const add = (ref, heading, body) => { cur = { ref, heading, text: body }; out.push(cur); return cur; };
  for (const raw of text.split(/\n/)) {
    const line = raw.trim(); if (!line) continue;
    let m;
    if ((m = line.match(/^Article\s+(\d+[a-z]?)\b\s*[:.\-–]?\s*(.*)$/i))) {
      kind = "art"; num = m[1]; annexPoint = "";
      wantHeading = add(`Art. ${num}`, m[2] || "", line); if (m[2]) wantHeading = null; continue;
    }
    if ((m = line.match(/^Annex\s+([IVXLC]+)\b\s*[:.\-–]?\s*(.*)$/i))) {
      kind = "annex"; num = m[1].toUpperCase(); annexPoint = "";
      wantHeading = add(`Annex ${num}`, m[2] || "", line); if (m[2]) wantHeading = null; continue;
    }
    if ((m = line.match(/^§\s*(\d+[a-z]?)\s*(.*)$/))) {
      kind = "par"; num = m[1]; annexPoint = "";
      wantHeading = add(`§ ${num}`, m[2] || "", line); if (m[2]) wantHeading = null; continue;
    }
    if (kind === "annex" && (m = line.match(/^Point\s+(\d+)\s*[:.\-–]?\s*(.*)$/i))) {
      annexPoint = m[1]; add(`Annex ${num} ${m[1]}`, m[2] || "", m[2] || line); wantHeading = null; continue;
    }
    if ((m = line.match(/^(\d+)\(([0-9a-z]+)\)\s+(.*)$/i))) {
      const ref = kind === "annex" ? `Annex ${num} ${m[1]}(${m[2]})` : kind === "par" ? `§ ${m[1]}(${m[2]})` : `Art. ${m[1]}(${m[2]})`;
      add(ref, "", m[3]); wantHeading = null; continue;
    }
    if (kind && (m = line.match(/^(\d+)\.\s+(.*)$/))) {
      if (kind === "annex") { annexPoint = m[1]; add(`Annex ${num} ${m[1]}`, "", m[2]); }
      else add(kind === "par" ? `§ ${num}(${m[1]})` : `Art. ${num}(${m[1]})`, "", m[2]);
      wantHeading = null; continue;
    }
    if (kind && kind !== "annex" && (m = line.match(/^\((\d+)\)\s+(.*)$/))) {
      add(kind === "par" ? `§ ${num}(${m[1]})` : `Art. ${num}(${m[1]})`, "", m[2]); wantHeading = null; continue;
    }
    if (kind === "annex" && annexPoint && (m = line.match(/^\(([a-z])\)\s+(.*)$/))) {
      add(`Annex ${num} ${annexPoint}(${m[1]})`, "", m[2]); wantHeading = null; continue;
    }
    if (wantHeading) { wantHeading.heading = line; wantHeading.text += " " + line; wantHeading = null; continue; }
    if (cur) cur.text += " " + line; else add("Preamble", line.slice(0, 70), line);
  }
  if (out.filter((p) => p.ref !== "Preamble").length < 2) {
    return text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
      .map((t, i) => ({ ref: `Para ${i + 1}`, heading: t.slice(0, 70), text: t }));
  }
  return out;
}

const normRef = (r) => String(r || "").toLowerCase()
  .replace(/article|art\.?/g, "art").replace(/points?|paragraph|para\.?/g, "")
  .replace(/[\s.,]/g, "");
function makeFinder(provs) {
  return (ref) => {
    const n = normRef(ref); if (!n) return null;
    return provs.find((p) => normRef(p.ref) === n)
      || (n.length >= 3 ? provs.find((p) => { const pn = normRef(p.ref); return pn.length >= 3 && (pn.endsWith(n) || n.endsWith(pn)); }) : null)
      || null;
  };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const clean = (q) => norm(q).replace(/^[."'…\s]+|[."'…\s]+$/g, "");
const isNIS = (r) => /not in source/i.test(r || "");
const quoteOk = (quote, text) => { const q = clean(quote); return q.length > 3 && norm(text).includes(q); };

const STOP = new Set("the and for with that this from shall are any such which their into under its has have not other been was were will may can all who what when where how our does bank banks use uses used using".split(" "));

/* ------------------------------------------------------------------ */
/* Agent tools (shared by both engines)                                */
/* ------------------------------------------------------------------ */

let toolCount = 0, turnCount = 0;
function makeTools(provs, profile) {
  const find = makeFinder(provs);
  const tick = () => { toolCount++; $("tc").textContent = toolCount; };
  return [
    {
      name: "get_bank_profile",
      description: "Returns the bank profile text: business model, clients and the systems the bank uses.",
      inputSchema: { type: "object", properties: {} },
      execute: () => { tick(); logTrace("", "🏦", "get_bank_profile", "()", profile.slice(0, 100) + (profile.length > 100 ? "…" : "")); return { profile }; },
    },
    {
      name: "list_provisions",
      description: "Returns the table of contents of the regulation: every provision reference with its heading or first words.",
      inputSchema: { type: "object", properties: {} },
      execute: () => {
        tick();
        const toc = provs.map((p) => ({ ref: p.ref, heading: p.heading || p.text.slice(0, 80) }));
        logTrace("", "📑", "list_provisions", "()", `${toc.length} provisions found`);
        return { provisions: toc };
      },
    },
    {
      name: "search_regulation",
      description: "Keyword search over the regulation text. Returns up to 6 matching provisions with snippets, best match first.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Keywords, e.g. 'creditworthiness credit score'" } }, required: ["query"] },
      execute: ({ query }) => {
        tick();
        const qs = String(query || "");
        const words = qs.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
        const hits = provs.map((p) => {
          const t = p.text.toLowerCase();
          return { p, score: words.filter((w) => t.includes(w)).length + (qs && t.includes(qs.toLowerCase()) ? 2 : 0) };
        }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
        logTrace(hits.length ? "" : "bad", "🔎", "search_regulation", `("${qs}")`, hits.length ? hits.map((h) => h.p.ref).join(", ") : "no match");
        return {
          hits: hits.map(({ p }) => {
            const t = p.text, lt = t.toLowerCase();
            const first = Math.min(...words.map((w) => lt.indexOf(w)).filter((x) => x >= 0), Infinity);
            const i = Number.isFinite(first) ? Math.max(0, first - 60) : 0;
            return { ref: p.ref, snippet: (i > 0 ? "…" : "") + t.slice(i, i + 260) + (t.length > i + 260 ? "…" : "") };
          }),
        };
      },
    },
    {
      name: "read_provisions",
      description: "Returns the full text of one or more provisions by reference, e.g. [\"Art. 26(2)\", \"Annex III 5(b)\"]. Unknown references are reported as not found.",
      inputSchema: { type: "object", properties: { refs: { type: "array", items: { type: "string" }, description: "Provision references from list_provisions" } }, required: ["refs"] },
      execute: ({ refs }) => {
        const list = (Array.isArray(refs) ? refs : [refs]).map(String).slice(0, 15);
        return {
          provisions: list.map((ref) => {
            tick(); const p = find(ref);
            logTrace(p ? "" : "bad", "📖", "read_provision", `("${ref}")`, p ? p.text.slice(0, 110) + (p.text.length > 110 ? "…" : "") : "not found");
            return p ? { ref: p.ref, text: p.text } : { ref, error: "not found" };
          }),
        };
      },
    },
    {
      name: "verify_citations",
      description: "Checks for each citation that the exact evidence phrase appears in the cited provision. Returns verified true/false per citation. Call before citing.",
      inputSchema: {
        type: "object",
        properties: { citations: { type: "array", items: { type: "object", properties: { ref: { type: "string" }, evidence: { type: "string" } }, required: ["ref", "evidence"] } } },
        required: ["citations"],
      },
      execute: ({ citations }) => {
        const list = Array.isArray(citations) ? citations.slice(0, 15) : [];
        return {
          results: list.map(({ ref, evidence } = {}) => {
            tick(); const p = find(ref); const ok = !!p && quoteOk(evidence, p.text);
            logTrace(ok ? "ok" : "bad", ok ? "✅" : "❌", "verify_citation", `("${ref}", "${String(evidence || "").slice(0, 60)}")`, ok ? "verified" : (p ? "phrase NOT in this provision" : "provision not found"));
            return { ref, verified: ok };
          }),
        };
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Engine 1: claude.ai (no API key)                                    */
/* ------------------------------------------------------------------ */

async function runOnClaudeAi(sample, input, signal) {
  const provs = parseProvisions(input.src);
  const tools = makeTools(provs, input.profile);
  let writing = false;
  const data = await sample.json(agentPrompt(input.q, settings.lang, "Then write the final answer: ONLY the JSON object, no markdown, no other text."), {
    tools,
    signal,
    modelTier: settings.tier,
    onText: ({ text }) => { if (!writing && /\{\s*"verdict"/.test(text)) { writing = true; logTrace("think", "✍️", "compose", "Writing cited impact analysis…", ""); } },
  });
  if (!data || typeof data !== "object" || !data.verdict) throw { code: "invalid_json", message: "No verdict in answer" };
  return { data, provs, engine: "Claude (claude.ai)" };
}

function sampleErrorText(e) {
  return ({
    not_granted: "Access to Claude was not granted for this page. Reload the page and allow it.",
    sampling_disabled: "Claude is not available for this account.",
    rate_limited: "Usage limit reached. Wait a moment and try again.",
    session_expired: "Your claude.ai session expired. Sign in again.",
    tools_unavailable: "This view cannot run agent tools. Open the page on claude.ai in the browser or the Claude app.",
    prompt_too_large: "The regulation text is too long for one run. Paste a shorter excerpt.",
    invalid_json: "The agent's final answer could not be read. Run it again.",
    refused: "Claude declined this request. Change the input and try again.",
    empty_completion: "The agent returned no answer. Run it again.",
  })[e?.code] || `Claude error (${e?.code || "unknown"}): ${e?.message || e}`;
}

/* ------------------------------------------------------------------ */
/* Engine 2: Anthropic API with the user's key (manual agent loop)     */
/* ------------------------------------------------------------------ */

const MAX_TURNS = 14;
let SDK = null;
async function sdk() { if (!SDK) SDK = (await import("./vendor/anthropic-sdk.mjs")).default; return SDK; }

async function runOnApi(input, signal) {
  const Anthropic = await sdk();
  const client = new Anthropic({ apiKey: settings.key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const provs = parseProvisions(input.src);
  const pageTools = makeTools(provs, input.profile);
  const find = makeFinder(provs);
  let final = null, rejections = 0, nudges = 0;

  const submit = {
    name: "submit_analysis",
    description: "Submit the final impact analysis. Every provision quote and every reference is checked against the regulation; if a check fails, you get the list of problems back and must fix them and submit again.",
    input_schema: SCHEMA,
    strict: true,
  };
  const tools = [...pageTools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })), submit];
  const system = agentPrompt(input.q, settings.lang, "Then call submit_analysis with the final answer. Do not write the answer as text.");
  const messages = [{ role: "user", content: "Run the impact analysis now. Start with round 1." }];

  const model = settings.model;
  let useFallback = model !== "claude-haiku-5-5", useCache = true;
  const call = async () => {
    const body = { model, max_tokens: 16000, system, tools, messages, output_config: { effort: "medium" } };
    if (useCache) body.cache_control = { type: "ephemeral" };
    try {
      return useFallback
        ? await client.beta.messages.create({ ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
        : await client.messages.create(body, { signal });
    } catch (e) {
      if (e?.status === 400 && useFallback && /fallback/i.test(e.message || "")) { useFallback = false; return call(); }
      if (e?.status === 400 && useCache && /cache_control/i.test(e.message || "")) { useCache = false; return call(); }
      throw e;
    }
  };

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    turnCount = turn; $("turns").textContent = turn;
    const res = await call();
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "refusal") throw new Error("Claude declined this request" + (res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "."));
    if (res.stop_reason === "max_tokens") throw new Error("The agent's answer was cut off. Try a shorter regulation text.");
    for (const b of res.content) if (b.type === "text" && b.text.trim()) logTrace("think", "🧠", "agent", b.text.trim().slice(0, 300), "");

    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) {
      if (nudges++ < 2) { messages.push({ role: "user", content: "Call submit_analysis with the final analysis now." }); continue; }
      throw new Error("The agent stopped without submitting an analysis.");
    }
    const results = [];
    for (const u of uses) {
      if (u.name === "submit_analysis") {
        const problems = checkSubmission(u.input, find);
        if (problems.length && rejections < 2) {
          rejections++;
          logTrace("bad", "↩️", "submit_analysis", "(rejected)", problems.join(" · "));
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Fix these problems and submit again:\n- " + problems.join("\n- ") });
        } else {
          logTrace("ok", "📤", "submit_analysis", "()", problems.length ? `accepted with ${problems.length} open issue(s)` : "all checks passed");
          final = u.input;
          results.push({ type: "tool_result", tool_use_id: u.id, content: "Accepted." });
        }
        continue;
      }
      const t = pageTools.find((x) => x.name === u.name);
      try {
        if (!t) throw new Error("Unknown tool " + u.name);
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await t.execute(u.input || {})) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: String(e.message || e) });
      }
    }
    messages.push({ role: "user", content: results });
    if (final) return { data: final, provs, engine: res.model };
  }
  throw new Error(`The agent did not finish within ${MAX_TURNS} turns.`);
}

function checkSubmission(d, find) {
  const p = [];
  (d.provisions || []).forEach((x) => {
    const prov = find(x.ref);
    if (!prov) p.push(`Provision "${x.ref}" does not exist. Use references from list_provisions.`);
    else if (!quoteOk(x.quote, prov.text)) p.push(`The quote for ${x.ref} is not verbatim in that provision. Copy an exact phrase.`);
  });
  [...(d.functions || []), ...(d.actions || []), d.direct_answer || {}].forEach((x) => {
    if (x.ref && !isNIS(x.ref) && !find(x.ref)) p.push(`Reference "${x.ref}" does not exist.`);
  });
  if ((d.exec_summary || []).length !== 3) p.push("exec_summary must have exactly 3 bullets.");
  return [...new Set(p)];
}

function apiErrorText(e, Anthropic) {
  if (!Anthropic) return e?.message || String(e);
  if (e instanceof Anthropic.AuthenticationError) return "Invalid API key. Open ⚙ settings and check your key.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key has no access to the selected model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limit reached. Wait a moment and try again.";
  if (e instanceof Anthropic.BadRequestError) return "Request rejected: " + (e.message || "bad request");
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach api.anthropic.com. Check your network connection.";
  if (e instanceof Anthropic.APIError) return `API error (${e.status ?? "?"}): ${e.message}`;
  return e?.message || String(e);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const settings = {
  get key() { return store.get("rr_key") || ""; },
  get model() { return $("model").value; },
  get tier() { return $("tier").value; },
  get lang() { return $("lang").value; },
};
$("model").value = store.pref("rr_model") || "claude-opus-5-5";
$("tier").value = store.pref("rr_tier") || "default";
$("lang").value = store.pref("rr_lang") || "English";
$("apiKey").value = settings.key;
try { $("remember").checked = !!localStorage.getItem("rr_key"); } catch {}
$("keySec").hidden = IN_CLAUDE;
$("claudeSec").hidden = !IN_CLAUDE;

function refreshMode() {
  const btn = $("modeBtn");
  if (IN_CLAUDE) { btn.classList.add("live"); $("modeTxt").textContent = "claude.ai account"; return; }
  const live = !!settings.key;
  btn.classList.toggle("live", live);
  const short = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" }[settings.model];
  $("modeTxt").textContent = live ? `API · ${short}` : "Add API key";
}
$("modeBtn").onclick = () => $("settings").showModal();
$("settings").addEventListener("close", () => {
  const k = $("apiKey").value.trim();
  if (k) store.set("rr_key", k, $("remember").checked); else store.del("rr_key");
  store.pref("rr_model", $("model").value); store.pref("rr_tier", $("tier").value); store.pref("rr_lang", $("lang").value);
  refreshMode();
});
$("clearKey").onclick = () => { $("apiKey").value = ""; store.del("rr_key"); $("remember").checked = false; refreshMode(); };
refreshMode();

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

function srcInfo() {
  const v = $("src").value.trim();
  if (!v) { $("srcInfo").textContent = "paste any regulation"; return; }
  const n = parseProvisions(v).length, words = v.split(/\s+/).length;
  $("srcInfo").textContent = `${words.toLocaleString()} words · ${n} provisions detected`;
}
$("src").addEventListener("input", srcInfo);
$("file").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; $("src").value = await f.text(); srcInfo(); e.target.value = ""; };
srcInfo();

/* ------------------------------------------------------------------ */
/* Trace + loading                                                     */
/* ------------------------------------------------------------------ */

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function logTrace(kind, icon, name, args, result) {
  const d = document.createElement("div"); d.className = "tr " + kind;
  d.innerHTML = `<span class="ic">${icon}</span><span><span class="nm">${esc(name)}</span> <span class="ar">${esc(args)}</span>${result !== "" ? `<span class="rs">→ ${esc(result)}</span>` : ""}</span>`;
  $("trace").appendChild(d); $("trace").scrollTop = $("trace").scrollHeight;
}
let clock, t0, ctl = null;
function show(which) { ["empty", "loading", "result"].forEach((id) => ($(id).hidden = id !== which)); }
function startLoading() {
  show("loading"); $("err").style.display = "none";
  $("trace").innerHTML = ""; toolCount = 0; turnCount = 0; $("tc").textContent = "0";
  $("turnsWrap").hidden = IN_CLAUDE; $("turns").textContent = "0";
  t0 = performance.now();
  clock = setInterval(() => ($("timer").textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s"), 100);
  logTrace("think", "🧠", "plan", "Reading task, planning approach…", "");
}
function stopLoading() { clearInterval(clock); }
function showErr(html) { $("err").innerHTML = html; $("err").style.display = "block"; }
function busy(on) {
  $("go").disabled = on; $("go").textContent = on ? "◎ Agent working…" : "◎ Run agent";
  $("stop").hidden = !on;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

let lastRun = null;
function render(run) {
  const d = run.data, src = run.src, find = makeFinder(run.provs);
  d.provisions = (d.provisions || []).slice(0, 6);
  d.functions = (d.functions || []).slice(0, 5);
  d.actions = (d.actions || []).slice(0, 7);
  const v = (d.verdict || "").toLowerCase();
  const cls = v.startsWith("not") ? "v-not" : v.startsWith("partial") ? "v-part" : "v-aff";
  const verified = d.provisions.filter((p) => quoteOk(p.quote, src)).length;
  const R = (r) => {
    if (!r) return "";
    if (isNIS(r)) return `<span class="ref nis">${esc(r)}</span>`;
    const ok = !!find(r);
    return `<span class="ref ${ok ? "" : "bad"}" data-ref="${esc(r)}" title="${ok ? "Show in source" : "Reference not found in the source text"}">${esc(r)}${ok ? "" : " ⚠"}</span>`;
  };

  let h = `<details class="trc"><summary>Agent trace: ${run.tools} tool calls${run.turns ? `, ${run.turns} turns` : ""} (click to expand)</summary><div class="trace">${run.trace}</div></details>
    <div class="toolbar">
      <button class="sbtn" id="copyMd">Copy as Markdown</button>
      ${IN_CLAUDE ? "" : `<button class="sbtn" id="dlMd">Download .md</button><button class="sbtn" id="print">Print / PDF</button>`}
    </div>
    <div class="verdict ${cls}"><span class="tag">${esc(d.verdict)}</span><div><h2>${esc(d.classification)}</h2><p>${esc(d.verdict_reason)}</p></div></div>
    <div class="meta">
      <span class="pill">Engine: <b>${esc(run.engine)}</b></span>
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
  $("kTools").textContent = run.tools;
  lastRun = run;

  $("copyMd").onclick = async () => {
    try { await navigator.clipboard.writeText(asMarkdown(d)); flash($("copyMd"), "Copied ✓"); } catch { flash($("copyMd"), "Copy blocked"); }
  };
  if (!IN_CLAUDE) {
    $("dlMd").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([asMarkdown(d)], { type: "text/markdown" }));
      a.download = `regradar-${(d.verdict || "result").toLowerCase().replace(/\s+/g, "-")}.md`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("print").onclick = () => window.print();
  }
  $("result").querySelectorAll(".ref[data-ref]").forEach((c) => (c.onclick = () => highlight(c.dataset.ref, null, run.provs)));
  $("result").querySelectorAll(".quote").forEach((c) => (c.onclick = () => highlight(c.dataset.ref, c.dataset.quote, run.provs)));
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
    d.actions.forEach((a, i) => L.push(`| ${i + 1} | ${String(a.action).replace(/\|/g, "/")} | ${a.owner} | ${a.priority} | ${a.ref} |`));
  }
  if (d.not_in_source?.length) { L.push("", "## Not in source"); d.not_in_source.forEach((x) => L.push(`- ${x}`)); }
  if (d.open_questions?.length) { L.push("", "## Open questions"); d.open_questions.forEach((x) => L.push(`- ${x}`)); }
  L.push("", "---", "_Generated with RegRadar Agent. Grounded only in the provided regulation text; verify against the official text._");
  return L.join("\n");
}

/* Jump to the cited passage in the regulation textarea. */
function highlight(ref, quote, provs) {
  const ta = $("src"), txt = ta.value;
  let start = -1, end = -1;
  if (quote) {
    const q = quote.trim();
    start = txt.indexOf(q); if (start < 0) start = txt.toLowerCase().indexOf(q.toLowerCase());
    if (start >= 0) end = start + q.length;
  }
  if (start < 0) {
    const p = makeFinder(provs)(ref); if (!p) return;
    start = txt.indexOf(p.text.slice(0, 40)); if (start < 0) return;
    end = txt.indexOf("\n", start); if (end < 0) end = txt.length;
  }
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  const charsPerLine = Math.max(20, Math.floor(ta.clientWidth / 7));
  const visualLine = txt.slice(0, start).split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / charsPerLine)), 0) - 1;
  ta.scrollIntoView({ behavior: "smooth", block: "center" });
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  ta.scrollTop = Math.max(0, (visualLine - 2) * lh);
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

async function run() {
  const input = { src: $("src").value.trim(), profile: $("profile").value.trim(), q: $("question").value.trim() };
  if (!input.src || !input.profile) { showErr("Please paste a regulation text and describe the bank."); return; }

  const sample = await samplePromise;
  if (!sample && !settings.key) {
    showErr(IN_CLAUDE
      ? "Claude is not available in this view. Open the page on claude.ai while signed in."
      : `This page needs Claude. Open the claude.ai version of RegRadar (no API key needed), or add an Anthropic API key in ⚙ settings.${CLAUDE_URL ? ` <br><a class="sbtn" href="${CLAUDE_URL}" target="_blank" rel="noopener">Open RegRadar on claude.ai</a>` : ""}`);
    return;
  }

  busy(true); startLoading(); ctl = new AbortController();
  try {
    const r = sample ? await runOnClaudeAi(sample, input, ctl.signal) : await runOnApi(input, ctl.signal);
    logTrace("ok", "🏁", "done", `(${toolCount} tool calls)`, "analysis complete");
    stopLoading();
    render({ ...r, src: input.src, secs: (performance.now() - t0) / 1000, tools: toolCount, turns: sample ? 0 : turnCount, trace: $("trace").innerHTML });
  } catch (e) {
    stopLoading();
    const cancelled = e?.code === "cancelled" || e?.name === "AbortError" || e?.constructor?.name === "APIUserAbortError";
    show(lastRun ? "result" : "empty");
    if (cancelled) showErr("Agent stopped.");
    else showErr("Agent run failed: " + esc(sample ? sampleErrorText(e) : apiErrorText(e, SDK)));
  } finally { busy(false); ctl = null; }
}
$("go").onclick = run;
$("stop").onclick = () => ctl?.abort();
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("go").disabled) run(); });
