// ---------- Utilities ----------
const $ = (id) => document.getElementById(id);
const log = (msg) => {
    const el = $("log");
    el.hidden = false;
    el.textContent += `\n${new Date().toLocaleTimeString()} → ${msg}`;
};

function mapLink(query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
function budgetLabel(b) {
    if (b === "low") return "$";
    if (b === "medium") return "$";
    if (b === "high") return "$$";
    return "$";
}

// ---------- Dynamic City Background ----------
function cityImageURL(city) {
    const q = encodeURIComponent(city);
    // Unsplash Source provides free, keyless random images
    return `https://source.unsplash.com/1600x900/?${q},landmark,cityscape`;
}
function setCityBackground(city) {
    const el = document.getElementById("cityBg");
    if (!el) return;
    const name = (city || "").trim();
    if (!name) {
        el.style.opacity = "0";
        el.style.backgroundImage = "";
        el.style.transform = "scale(1.02)";
        return;
    }
    const url = cityImageURL(name);
    // Start faded while loading
    el.style.opacity = "0.2";
    el.style.transform = "scale(1.02)";
    const img = new Image();
    img.onload = () => {
        el.style.backgroundImage = `url('${url}')`;
        requestAnimationFrame(() => {
            el.style.opacity = "1";
            el.style.transform = "scale(1)";
        });
    };
    img.onerror = () => {
        el.style.opacity = "0";
    };
    img.referrerPolicy = "no-referrer";
    img.src = url;
}
function debounce(fn, wait = 500) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

// ---------- Prompt Builder (for LLM) ----------
function buildSystemPrompt() {
    return `You are a smart travel planner. Cover exactly one region per day for the chosen city.

For each day (region):
- List top activities/sights with place names (openable in Google Maps)
- For each item include: region name, approximate distance, suggested travel option (walking or public transport), and the best time to visit
- Dining: breakfast, lunch, dinner suggestions with the same distance/mode/best-time fields
- Where to Stay IN THAT REGION: 1–2 area/property recommendations aligned to the user's budget

Also provide a short day-by-day summary that sequences regions logically to minimize travel.

Rules:
- Make the plan realistic (consider travel time, cost, and opening hours)
- Prefer walking if the distance is short; otherwise suggest public transport
- Mix popular attractions with hidden gems
- Adjust style (family, luxury, budget, adventure, cultural) if the user asks
- If details are missing, ask the user first
- Return the final plan in a clean, easy-to-read format`;
}
function buildUserPrompt(values) {
    const { city, days, budget, style, diet, pace } = values;
    return `Plan a trip to ${city} for ${days} days with a ${budget} budget.
Style: ${style}; Pace: ${pace}; Diet: ${diet || "none specified"}.
Cover exactly one region per day. For each region include activities (with place names that can open in Google Maps), dining (breakfast/lunch/dinner), and WHERE TO STAY IN THAT REGION aligned to the budget. For every item include: region, approximate distance, suggested travel option (walking or public transport), and the best time to visit/eat. End with a short day-by-day summary that sequences regions to minimize travel.`;
}

// ---------- Local Heuristic Generator (no AI) ----------
const CATEGORIES = {
    balanced: ["landmark", "museum", "park", "market", "neighborhood", "viewpoint", "riverfront", "hidden gem"],
    family: ["zoo", "theme park", "interactive museum", "park", "aquarium", "neighborhood", "market", "viewpoint"],
    adventure: ["hiking trail", "bike tour", "water activity", "city viewpoint", "market", "local street food", "sunset spot"],
    luxury: ["iconic landmark", "art museum", "boutique district", "fine dining", "spa", "sky bar", "river cruise"],
    budget: ["free walking tour", "public park", "local market", "street food lane", "neighborhood", "viewpoint"],
    cultural: ["historic district", "temple or church", "national museum", "local craft market", "heritage walk", "traditional performance"],
};

function pick(list, n) {
    const out = [];
    const copy = [...list];
    while (out.length < n) {
        const i = Math.floor(Math.random() * copy.length);
        out.push(copy.splice(i, 1)[0] || list[i % list.length]);
    }
    return out;
}

function mealQuery(meal, city, budget, diet) {
    let base = meal + " restaurants " + city;
    if (diet) base = diet + " " + base;
    if (budget) base = (budget + " " + base).trim();
    return base;
}

// Regions and staying heuristics
const DEFAULT_REGIONS = [
    "Central District", "Old Town", "Riverside", "Business District", "University Area",
    "Historic District", "Waterfront", "Arts District", "Market Quarter", "Garden District"
];
function pickRegions(city) {
    // Cities vary; provide a generic spread of areas. Deduped selection via existing pick().
    return pick(DEFAULT_REGIONS, 4);
}
function randomFrom(list) { return list[Math.floor(Math.random() * list.length)]; }
function stayOptions(city, budget, regions) {
    const type = budget === "low" ? "hostel or guesthouse" : budget === "high" ? "luxury 5-star hotel" : "boutique 3–4 star hotel";
    const areas = (regions && regions.length ? regions.slice(0, 3) : pick(DEFAULT_REGIONS, 3));
    return areas.map(area => ({
        area,
        type,
        link: mapLink(`${type} ${city} ${area}`)
    }));
}

// Heuristics for distance, transport mode, and best time
function randFloat(min, max) { return +(Math.random() * (max - min) + min).toFixed(1); }
function travelModeForKm(km) { return km <= 1.7 ? "Walking" : "Public transport"; }
function bestTimeForSlot(slot) {
    const s = (slot || "").toLowerCase();
    if (s.includes("late") || s === "midday") return "midday (12–2pm)";
    if (s.includes("morning")) return "morning (8–11am)";
    if (s.includes("afternoon")) return "afternoon (1–4pm)";
    if (s.includes("evening")) return "evening (5–8pm)";
    return "anytime";
}
function bestTimeForMeal(type) {
    const t = (type || "").toLowerCase();
    if (t.includes("breakfast")) return "morning (8–10am)";
    if (t.includes("lunch")) return "midday (12–2pm)";
    if (t.includes("dinner")) return "evening (7–9pm)";
    return "anytime";
}

function generateLocalPlan(values) {
    const { city, days, budget, style, diet, pace } = values;
    const cat = CATEGORIES[style] || CATEGORIES.balanced;
    const daysInt = Math.max(1, Math.min(30, parseInt(days, 10) || 1));
    const results = [];
    const regions = pickRegions(city);
    const paceSlots =
        pace === "packed"
            ? ["Morning", "Midday", "Afternoon", "Evening"]
            : pace === "relaxed"
                ? ["Late Morning", "Afternoon", "Evening"]
                : ["Morning", "Afternoon", "Evening"];
    const regionOrder = Array.from({ length: daysInt }, (_, i) => regions[i % regions.length]);

    for (let d = 1; d <= daysInt; d++) {
        const dayRegion = regionOrder[d - 1];
        const slots = pick(cat, paceSlots.length);
        const items = paceSlots.map((slot, idx) => {
            const tag = slots[idx];
            const q = `${tag} in ${city}`;
            const distanceKm = randFloat(0.4, 3.5);
            const mode = travelModeForKm(distanceKm);
            const best = bestTimeForSlot(slot);
            return { slot, title: tag.charAt(0).toUpperCase() + tag.slice(1), link: mapLink(q), distanceKm, mode, bestTime: best, region: dayRegion };
        });

        const meals = [
            { type: "Breakfast", q: mealQuery("breakfast", city, budgetLabel(budget), diet) },
            { type: "Lunch", q: mealQuery("lunch", city, budgetLabel(budget), diet) },
            { type: "Dinner", q: mealQuery("dinner", city, budgetLabel(budget), diet) },
        ].map((m) => {
            const distanceKm = randFloat(0.2, 2.0);
            const mode = travelModeForKm(distanceKm);
            return { type: m.type, link: mapLink(m.q), distanceKm, mode, bestTime: bestTimeForMeal(m.type), region: dayRegion };
        });

        const summary = `Day ${d} blends ${items.map((i) => i.title.toLowerCase()).join(", ")} with ${budget} budget meals${diet ? ` (${diet})` : ""
            }.`;

        results.push({ day: d, items, meals, summary });
    }
    return results;
}

function renderPlan(plan, meta) {
    const { city } = meta;
    if (!plan || !plan.length) {
        $("output").innerHTML = "No plan generated.";
        return;
    }
    const html = plan.map((d) => {
        const region = d.items[0]?.region || d.meals[0]?.region || "City Center";
        const items = d.items
            .map((it) => `<li><span class="pill">${it.slot}</span> <a href="${it.link}" target="_blank" rel="noopener">${it.title}</a> <span class="meta">• region: ${it.region} • ~${it.distanceKm} km • ${it.mode} • best: ${it.bestTime}</span></li>`)
            .join("");
        const meals = d.meals
            .map((m) => `<li><span class="pill">${m.type}</span> <a href="${m.link}" target="_blank" rel="noopener">Open ${m.type} options near ${city}</a> <span class="meta">• region: ${m.region} • ~${m.distanceKm} km • ${m.mode} • best: ${m.bestTime}</span></li>`)
            .join("");
        const stayType = meta.budget === "low" ? "hostel or guesthouse" : meta.budget === "high" ? "luxury 5-star hotel" : "boutique 3–4 star hotel";
        const stayLink = mapLink(`${stayType} ${city} ${region}`);
        const stay = `<li><span class="pill">Stay</span> <a href="${stayLink}" target="_blank" rel="noopener">${stayType} in ${region}</a> <span class="meta">• budget: ${meta.budget}</span></li>`;

        return `<div class="day"><h3>Day ${d.day} — Region: ${region}</h3>
      <div class="meta">Tap links to open Google Maps searches.</div>
      <h4>Highlights</h4>
      <ul>${items}</ul>
      <h4>Eating</h4>
      <ul>${meals}</ul>
      <h4>Where to Stay</h4>
      <ul>${stay}</ul>
      <div class="meta">Summary: ${d.summary}</div>
    </div>`;
    }).join("");
    $("output").innerHTML = html;
}

// ---------- AI Call (optional, BYO endpoint/key) ----------
async function generateAI(values) {
    const endpoint = $("aiEndpoint").value.trim();
    const model = $("aiModel").value.trim();
    const key = $("aiKey").value.trim();
    const maxTokens = parseInt($("maxTokens").value || 900, 10);
    if (!endpoint || !model || !key) {
        alert("To use AI, provide endpoint, model, and API key — or toggle off 'Use AI'.");
        throw new Error("Missing AI credentials");
    }
    const payload = {
        model,
        messages: [
            { role: "system", content: buildSystemPrompt() },
            { role: "user", content: buildUserPrompt(values) },
        ],
        temperature: 0.8,
        max_tokens: maxTokens,
    };
    log("Calling AI endpoint…");
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error("AI error: " + res.status + " — " + t);
    }
    const data = await res.json();
    // Try to extract text in common shapes (OpenAI-compatible)
    const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || JSON.stringify(data);
    $("output").textContent = (text || "").trim();
    log("AI response rendered.");
}

// ---------- Event Handlers ----------
$("generate").addEventListener("click", async () => {
    const values = {
        city: $("city").value.trim(),
        days: $("days").value.trim(),
        budget: $("budget").value || "medium",
        style: $("style").value || "balanced",
        diet: $("diet").value.trim(),
        pace: $("pace").value || "moderate",
    };
    if (!values.city) {
        alert("Please enter a city.");
        return;
    }
    if (!values.days) {
        alert("Please enter number of days.");
        return;
    }

    setCityBackground(values.city);
    updateTravelFX(values);

    try {
        if ($("useAI").checked) {
            await generateAI(values);
        } else {
            const plan = generateLocalPlan(values);
            renderPlan(plan, values);
            log("Local plan generated.");
        }
    } catch (err) {
        console.error(err);
        log(err.message);
        alert(err.message);
    }
});

$("copyPrompt").addEventListener("click", () => {
    const values = {
        city: $("city").value.trim() || "<City>",
        days: $("days").value.trim() || "<Days>",
        budget: $("budget").value || "medium",
        style: $("style").value || "balanced",
        diet: $("diet").value.trim() || "none",
        pace: $("pace").value || "moderate",
    };
    const sys = buildSystemPrompt();
    const usr = buildUserPrompt(values);
    const prompt = `SYSTEM:\n${sys}\n\nUSER:\n${usr}`;
    navigator.clipboard.writeText(prompt).then(() => {
        log("Prompt copied to clipboard.");
        alert("AI prompt copied. Paste it into your model playground or backend.");
    });
});

$("clear").addEventListener("click", () => {
    ["city", "days", "diet", "aiKey", "aiEndpoint", "aiModel"].forEach((id) => ($(`${id}`).value = ""));
    $("budget").value = "";
    $("style").value = "balanced";
    $("pace").value = "moderate";
    $("output").innerHTML = "Cleared. Enter details and generate again.";
    $("log").textContent = "";
    $("log").hidden = true;
    setCityBackground("");
});

// Live-update background as user types city (debounced)
$("city").addEventListener("input", debounce(() => {
    const cityVal = $("city").value.trim();
    setCityBackground(cityVal);
    updateTravelFX(getCurrentValues());
}, 500));

// ---------- Futuristic Travel Network Background (Canvas) ----------
const travelFX = {
    canvas: null,
    ctx: null,
    routes: [],
    theme: null,
    speed: 0.00055,
    dpr: 1,
    animId: 0,
    lastTs: 0,
};
const PREFERS_REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function getCurrentValues(){
    return {
        city: $("city").value.trim() || "",
        days: $("days").value.trim() || "4",
        budget: $("budget").value || "medium",
        style: $("style").value || "balanced",
        diet: $("diet").value.trim() || "",
        pace: $("pace").value || "moderate",
    };
}

function ensureTravelCanvas(){
    if (travelFX.canvas && travelFX.ctx) return;
    const c = document.createElement('canvas');
    c.className = 'travel-canvas';
    // Inline styles keep it self-contained
    Object.assign(c.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '0',
        pointerEvents: 'none',
        mixBlendMode: 'screen',
        opacity: '0.85',
    });
    const ctx = c.getContext('2d');
    const cityBg = document.getElementById('cityBg');
    if (cityBg && cityBg.parentNode){
        cityBg.parentNode.insertBefore(c, cityBg.nextSibling); // above city image, below content
    } else {
        document.body.insertBefore(c, document.body.firstChild);
    }
    travelFX.canvas = c;
    travelFX.ctx = ctx;
    resizeTravelCanvas();
    window.addEventListener('resize', resizeTravelCanvas);
}

function resizeTravelCanvas(){
    if (!travelFX.canvas) return;
    const { canvas } = travelFX;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    travelFX.dpr = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (travelFX.ctx){
        travelFX.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

function rand(min, max){ return Math.random() * (max - min) + min; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function bezierPoint(p0, p1, p2, p3, t){
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
}

function themeFrom(values){
    const style = (values.style || 'balanced').toLowerCase();
    const budget = (values.budget || 'medium').toLowerCase();
    const pace = (values.pace || 'moderate').toLowerCase();
    const speed = pace === 'packed' ? 0.00085 : pace === 'relaxed' ? 0.00038 : 0.00055;
    const gold = '#ffd479';
    const blue = '#5aa0ff';
    const cyan = '#74ffd7';
    const magenta = '#ff77e1';
    const amber = '#ffc46b';
    const violet = '#a38bff';

    let line = blue, glow = cyan, dot = '#ffffff';
    switch(style){
        case 'adventure': line = '#ff8a5a'; glow = cyan; dot = '#fff0e6'; break;
        case 'luxury': line = gold; glow = violet; dot = '#fff7e6'; break;
        case 'family': line = magenta; glow = blue; dot = '#ffe6f7'; break;
        case 'budget': line = cyan; glow = blue; dot = '#e6fffb'; break;
        case 'cultural': line = violet; glow = amber; dot = '#f2e6ff'; break;
        default: line = blue; glow = cyan; dot = '#eaf7ff';
    }
    // Slightly richer if high budget, more subtle if low
    const lineAlpha = budget === 'high' ? 0.9 : budget === 'low' ? 0.55 : 0.7;
    const glowAlpha = budget === 'high' ? 0.85 : budget === 'low' ? 0.55 : 0.7;
    return { line, glow, dot, lineAlpha, glowAlpha, speed };
}

function buildRoutes(values){
    const countBase = clamp(parseInt(values.days,10) || 4, 1, 14);
    const count = clamp(Math.round(countBase * 3), 8, 22);
    const style = (values.style || 'balanced').toLowerCase();
    const w = window.innerWidth, h = window.innerHeight;
    const routes = [];

    function randPoint(edgeBias){
        // edgeBias in [0..1], higher = nearer edges
        const bx = edgeBias ? (Math.random() < 0.5 ? rand(0, 0.15*w) : rand(0.85*w, w)) : rand(0.05*w, 0.95*w);
        const by = edgeBias ? (Math.random() < 0.5 ? rand(0, 0.2*h) : rand(0.8*h, h)) : rand(0.1*h, 0.9*h);
        return { x: bx, y: by };
    }

    for (let i=0;i<count;i++){
        const edgey = Math.random() < 0.55;
        const p0 = randPoint(edgey);
        const p3 = randPoint(edgey);
        const curvature = style === 'adventure' ? rand(0.35, 0.9)
                          : style === 'cultural' ? rand(0.25, 0.7)
                          : style === 'luxury' ? rand(0.18, 0.55)
                          : rand(0.2, 0.6);
        const p1 = { x: p0.x + (p3.x - p0.x) * curvature + rand(-120,120), y: p0.y + rand(-180,180) };
        const p2 = { x: p3.x - (p3.x - p0.x) * curvature + rand(-120,120), y: p3.y + rand(-180,180) };
        routes.push({ p0, p1, p2, p3, t: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: rand(0.4, 1.2) });
    }
    travelFX.routes = routes;
}

function drawFrame(ts){
    if (PREFERS_REDUCED) return; // Respect reduced motion
    const { ctx, canvas, routes, theme } = travelFX;
    if (!ctx || !canvas || !routes || !routes.length || !theme) return;
    const dt = travelFX.lastTs ? Math.min(50, ts - travelFX.lastTs) : 16;
    travelFX.lastTs = ts;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';

    for (const r of routes){
        const step = clamp(travelFX.speed * r.speed, 0.00015, 0.0012);
        r.t += step * r.dir * (dt);
        if (r.t > 1 || r.t < 0){
            // Restart with new curve to keep scene fresh
            r.t = r.dir > 0 ? 0 : 1;
            // Re-seed control points slightly
            const w = window.innerWidth, h = window.innerHeight;
            const p0 = { x: rand(0, w), y: rand(0, h) };
            const p3 = { x: rand(0, w), y: rand(0, h) };
            const p1 = { x: p0.x + rand(-200, 200), y: p0.y + rand(-220, 220) };
            const p2 = { x: p3.x + rand(-200, 200), y: p3.y + rand(-220, 220) };
            r.p0 = p0; r.p1 = p1; r.p2 = p2; r.p3 = p3;
        }

        // Draw partial curve 0..t
        const segs = 36;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = theme.line;
        ctx.globalAlpha = theme.lineAlpha;
        ctx.beginPath();
        let pt0 = bezierPoint(r.p0, r.p1, r.p2, r.p3, 0);
        ctx.moveTo(pt0.x, pt0.y);
        for (let s=1; s<=segs * r.t; s++){
            const t = s / segs;
            const p = bezierPoint(r.p0, r.p1, r.p2, r.p3, t);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        // Moving dot
        const head = bezierPoint(r.p0, r.p1, r.p2, r.p3, clamp(r.t, 0, 1));
        ctx.shadowBlur = 22;
        ctx.fillStyle = theme.dot;
        ctx.globalAlpha = theme.glowAlpha;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.2, 0, Math.PI*2);
        ctx.fill();
    }

    travelFX.animId = requestAnimationFrame(drawFrame);
}

function updateTravelFX(values){
    if (PREFERS_REDUCED) return; // no animation for reduced motion
    ensureTravelCanvas();
    travelFX.theme = themeFrom(values);
    travelFX.speed = travelFX.theme.speed;
    buildRoutes(values);
    travelFX.lastTs = 0;
    if (travelFX.animId) cancelAnimationFrame(travelFX.animId);
    travelFX.animId = requestAnimationFrame(drawFrame);
}

// Update animation as user tweaks travel options
;['style','pace','budget','days'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => updateTravelFX(getCurrentValues()));
});

// Initialize a subtle scene so landing page feels alive
updateTravelFX(getCurrentValues());
