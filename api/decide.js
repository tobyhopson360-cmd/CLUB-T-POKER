// /api/decide.js (CommonJS so Vercel runs it without extra config)
module.exports = async function (req, res) {
  try {
    const {
      players, position, hand, situation,
      limpers, openSize, openPos, openCallers,
      threeBetSize, threeBetIP, threeBetCallers,
      style = "standard",
      bluffing = "normal"
    } = req.query || {};

    if (!players || !position || !hand || !situation) {
      return res.status(400).json({ error: "Missing required fields: players, position, hand, situation" });
    }

    const sys = `You are a poker pre-flop decision assistant.
Return STRICT JSON ONLY with keys:
decision, confidence, rationale, when_fold, when_call, when_raise, risk_flags.
Consider price (pot odds), position, hand group, table size, and opponent tendencies.
More bluffs -> calling improves. Tight/large sizings -> folding improves (esp OOP).
Premium -> prefer aggressive lines. Multiway increases risk. Return minified JSON.`;

    const usr = `Table: ${players} players
Position: ${position}
Hand: ${hand}
Situation: ${situation}
Details: limpers=${limpers ?? "-"}, openSize=${openSize ?? "-"}xBB, openPos=${openPos ?? "-"}, openCallers=${openCallers ?? "-"}, threeBetSize=${threeBetSize ?? "-"}xBB, threeBetIP=${threeBetIP ?? "-"}, threeBetCallers=${threeBetCallers ?? "-"}
Opponent profile: style=${style}, bluffing=${bluffing}
Return JSON only with the specified keys.`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY not set on server" });

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ]
      })
    });

    if (!upstream.ok) {
      const txt = await upstream.text();
      return res.status(502).json({ error: "Upstream model error", detail: txt });
    }

    const payload = await upstream.json();
    const raw = payload?.choices?.[0]?.message?.content?.trim() || "";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      parsed = {
        decision: "Call",
        confidence: 0.5,
        rationale: "Fallback used because model did not return valid JSON.",
        when_fold: ["Large raises out of position", "Very tight ranges from early position"],
        when_call: ["Good price in position vs bluff-heavy players", "Playable hand with equity"],
        when_raise: ["Premium hands for value", "Late position vs weak/open ranges"],
        risk_flags: ["Invalid JSON from model"]
      };
    }

    const out = {
      decision: String(parsed.decision || "Call"),
      confidence: Number(parsed.confidence ?? 0.5),
      rationale: String(parsed.rationale || ""),
      when_fold: Array.isArray(parsed.when_fold) ? parsed.when_fold : [],
      when_call: Array.isArray(parsed.when_call) ? parsed.when_call : [],
      when_raise: Array.isArray(parsed.when_raise) ? parsed.when_raise : [],
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : []
    };

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
};
