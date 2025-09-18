// /api/decide.js (CommonJS)
module.exports = async function (req, res) {
  try {
    const {
      players, position, hand, situation,
      limpers, openSize, openPos, openCallers,
      threeBetSize, threeBetIP, threeBetCallers,
      style = "standard",   // aggressive | passive | standard
      bluffing = "normal"   // high | normal | low
    } = req.query || {};

    if (!players || !position || !hand || !situation) {
      return res.status(400).json({ error: "Missing required fields: players, position, hand, situation" });
    }

    const sys = `You are a poker pre-flop decision assistant.
Return STRICT JSON ONLY with this exact shape:
{
  "decision": "Fold | Call | Raise | 3-bet | 4-bet/Call",
  "confidence": 0.0,
  "rationale": "Max two short sentences explaining the recommended action in THIS scenario.",
  "fold_text": "ONE short sentence (<=18 words) tailored to THIS scenario: when folding is best. Use inputs (position, sizing, bluffing, callers).",
  "call_text": "ONE short sentence (<=18 words) tailored to THIS scenario: when calling is best. Use inputs (price, position, bluffing).",
  "raise_text": "ONE short sentence (<=18 words) tailored to THIS scenario: when raising/3-betting is best. Use inputs (hand strength, position, sizings).",
  "risk_flags": ["short warnings like 'multiway', 'OOP vs strong range'"]
}
Guidelines: Be specific, concise, and input-grounded. If bluffing is high, mention calling improves; if sizes are large or OOP, mention folding more.
Output MINIFIED JSON only (no backticks, no prose).`;

    const usr = `Inputs:
- Table: ${players} players
- Position: ${position}
- Hand: ${hand}
- Situation: ${situation}
- Details: limpers=${limpers ?? "-"}, openSize=${openSize ?? "-"}xBB, openPos=${openPos ?? "-"}, openCallers=${openCallers ?? "-"}, threeBetSize=${threeBetSize ?? "-"}xBB, threeBetIP=${threeBetIP ?? "-"}, threeBetCallers=${threeBetCallers ?? "-"}
- Opponent profile: style=${style}, bluffing=${bluffing}
Return JSON only with the exact keys specified. Each *_text must be a single, punchy sentence tied to THESE inputs.`;

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
        rationale: "Fallback used due to invalid model JSON.",
        fold_text: "Fold OOP versus large sizing or tight ranges.",
        call_text: "Call IP at good price, especially versus bluff-heavy opponents.",
        raise_text: "3-bet premium hands; value-raise small opens in position.",
        risk_flags: ["Invalid JSON from model"]
      };
    }

    const out = {
      decision: String(parsed.decision || "Call"),
      confidence: Number(parsed.confidence ?? 0.5),
      rationale: String(parsed.rationale || ""),
      fold_text: String(parsed.fold_text || ""),
      call_text: String(parsed.call_text || ""),
      raise_text: String(parsed.raise_text || ""),
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags : []
    };

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
};
