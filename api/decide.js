// /api/decide.js
export default async function handler(req, res) {
  try {
    const {
      players, position, hand, situation,
      limpers, openSize, openPos, openCallers,
      threeBetSize, threeBetIP, threeBetCallers,
      // optional opponent profile (defaults if not provided)
      style = "standard",      // aggressive | passive | standard
      bluffing = "normal"      // high | normal | low
    } = req.query;

    // Basic validation
    if (!players || !position || !hand || !situation) {
      return res.status(400).json({ error: "Missing required fields: players, position, hand, situation" });
    }

    const sys = `You are a poker pre-flop decision assistant.
Return STRICT JSON ONLY with this shape:
{
  "decision": "Fold | Call | Raise | 3-bet | 4-bet/Call",
  "confidence": 0.0,
  "rationale": "One or two sentences, plain English.",
  "when_fold": ["..."],
  "when_call": ["..."],
  "when_raise": ["..."],
  "risk_flags": ["..."]
}
Rules of thumb:
- Consider price (pot odds), position, hand group (premium/strong/playable/speculative), table size, and opponent tendencies.
- More bluffs -> calling becomes better, especially in position at a good price.
- Tight/large sizings -> folding becomes better, especially out of position.
- Premium hands prefer aggression (3-bet/raise), especially in position.
- Multiway pots increase risk; tighten marginal calls out of position.
Output valid minified JSON. Do not include backticks or any extra text.`;

    const usr = `Table: ${players} players
Position: ${position}
Hand: ${hand}
Situation: ${situation}
Details: limpers=${limpers ?? "-"}, openSize=${openSize ?? "-"}xBB, openPos=${openPos ?? "-"}, openCallers=${openCallers ?? "-"}, threeBetSize=${threeBetSize ?? "-"}xBB, threeBetIP=${threeBetIP ?? "-"}, threeBetCallers=${threeBetCallers ?? "-"}
Opponent profile: style=${style}, bluffing=${bluffing}
Return JSON only as specified.`;

    // Call OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set on server" });
    }

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ]
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(502).json({ error: "Upstream model error", detail: txt });
    }

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Very small fallback if JSON parse fails
      parsed = {
        decision: "Call",
        confidence: 0.5,
        rationale: "Fallback: price/position looks acceptable; JSON from model was invalid.",
        when_fold: ["Facing large raises out of position", "Tight ranges from early position"],
        when_call: ["Good price vs bluff-heavy opponents", "In position with playable hands"],
        when_raise: ["Premium hands for value", "Late position vs weak opens"],
        risk_flags: ["Model JSON parse failed; used fallback"]
      };
    }

    // Ensure minimal shape
    const out = {
      decision: String(parsed.decision || "Call"),
      confidence: Number(parsed.confidence ?? 0.5),
      rationale: String(parsed.rationale || "No rationale provided."),
      when_fold: Array.isArray(parsed.when_fold) ? parsed.when_fold : [],
      when_call: Array.isArray(parsed.when_call) ? parsed.when_call : [],
      when_raise: Array.isArray(parsed.when_raise) ? parsed.when_raise : [],
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : []
    };

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
