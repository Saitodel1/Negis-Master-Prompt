import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase-admin.js";

const router = Router();

router.post("/auth/reset-password", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Введите корректный email" });
    return;
  }

  const redirectTo = process.env.PASSWORD_RECOVERY_REDIRECT_URL || "https://crm.negis.online/reset-password";
  await supabaseAdmin.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });

  // Intentionally identical for unknown and known addresses.
  res.json({ ok: true });
});

export default router;
