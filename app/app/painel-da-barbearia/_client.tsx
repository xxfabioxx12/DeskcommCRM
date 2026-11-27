"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";
import {
  PainelBarbearia,
  type DadosPainelBarbearia,
  type DestinoBarbearia,
} from "@/components/barbearia/PainelBarbearia";
import { DESTINOS_BARBEARIA } from "@/lib/barbearia/config";
import { destinosDaInterface } from "@/lib/navigation/interface";

export function PainelBarbeariaConectado() {
  const { activeOrg, user } = useAuth();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["painel-barbearia", activeOrg?.orgId],
    queryFn: async () =>
      (await apiClient.get<{ data: DadosPainelBarbearia }>("/api/v1/reports/barbearia")).data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const navegar = (destino: DestinoBarbearia) => router.push(DESTINOS_BARBEARIA[destino]);
  const destinos = new Set(
    destinosDaInterface(
      activeOrg?.interface_settings,
      user.is_platform_admin && !user.support,
      activeOrg?.role ?? null,
      activeOrg?.modulos_ligados ?? [],
      activeOrg?.capacidades_ligadas ?? [],
    ).map((d) => d.href),
  );
  const permitidos = (Object.keys(DESTINOS_BARBEARIA) as DestinoBarbearia[]).filter((d) =>
    destinos.has(DESTINOS_BARBEARIA[d]),
  );
  if (query.isError)
    return (
      <div className="barbearia-painel">
        <h1>Não foi possível carregar o painel.</h1>
        <p role="alert">
          Os dados estão indisponíveis. Isso não significa que o caixa ou a agenda estejam vazios.
        </p>
        <button className="bb-primary" onClick={() => void query.refetch()}>
          Tentar novamente
        </button>
      </div>
    );
  if (!query.data)
    return (
      <div className="barbearia-painel" role="status">
        Carregando dados da barbearia…
      </div>
    );
  return (
    <div>
      <div className="flex justify-end p-2">
        <button
          className="text-xs underline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? "Atualizando…" : "Atualizar dados"}
        </button>
      </div>
      <PainelBarbearia dados={query.data} permitidos={permitidos} onAbrir={navegar} />
    </div>
  );
}
