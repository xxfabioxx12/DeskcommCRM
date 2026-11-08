import { notFound, redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { painelBarbeariaLigado } from "@/lib/barbearia/config";
import { PainelBarbeariaConectado } from "./_client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Painel da barbearia" };
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!roleAtLeast(org.role, "manager")) redirect("/403");
  const db = await createClient();
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", org.orgId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível consultar a configuração do painel.");
  if (!painelBarbeariaLigado(data?.settings)) notFound();
  return <PainelBarbeariaConectado key={org.orgId} />;
}
