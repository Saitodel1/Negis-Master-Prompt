import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../lib/supabase-admin.js";

export type AuthenticatedRequest = Request & { authUserId?: string };

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const value = req.header("authorization") ?? "";
  const token = value.startsWith("Bearer ") ? value.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.authUserId = data.user.id;
  next();
}

export async function requireClinicManager(req: AuthenticatedRequest, res: Response, clinicId: string) {
  if (!req.authUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", req.authUserId)
    .eq("clinic_id", clinicId)
    .in("role", ["owner", "manager"])
    .maybeSingle();

  if (error || !data) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }

  return true;
}
