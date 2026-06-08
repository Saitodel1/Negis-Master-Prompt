import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin.js";

const router = Router();

router.post("/leads/webhook/:clinic_id", async (req, res) => {
  const { clinic_id } = req.params;

  const { data: clinic, error: clinicErr } = await supabaseAdmin
    .from("clinics")
    .select("id, webhook_secret, telegram_chat_id")
    .eq("id", clinic_id)
    .single();

  if (clinicErr || !clinic) {
    res.status(404).json({ error: "Clinic not found" });
    return;
  }

  const secret = req.headers["x-webhook-secret"];
  if (!secret || secret !== clinic.webhook_secret) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  const { first_name, last_name, phone, source, comment } = req.body as {
    first_name?: string;
    last_name?: string;
    phone?: string;
    source?: string;
    comment?: string;
  };

  if (!phone) {
    res.status(400).json({ error: "phone is required" });
    return;
  }

  const { data: statusRow } = await supabaseAdmin
    .from("lead_statuses")
    .select("id")
    .eq("clinic_id", clinic_id)
    .order("position")
    .limit(1)
    .single();

  const { error: insertErr } = await supabaseAdmin.from("leads").insert({
    clinic_id,
    first_name: first_name || null,
    last_name: last_name || null,
    phone,
    source: source || "Webhook",
    comment: comment || null,
    status_id: statusRow?.id || null,
  });

  if (insertErr) {
    res.status(500).json({ error: insertErr.message });
    return;
  }

  if (clinic.telegram_chat_id) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      const name = [first_name, last_name].filter(Boolean).join(" ") || "Неизвестный";
      const text = `Новый лид (Webhook)\nИмя: ${name}\nТелефон: ${phone}\nИсточник: ${source || "Webhook"}`;
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: clinic.telegram_chat_id, text }),
      }).catch(() => {});
    }
  }

  res.status(200).json({ success: true });
});

export default router;
