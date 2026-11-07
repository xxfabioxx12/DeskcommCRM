/** Organização NODZ: trabalho primeiro; histórico separado; filtros e contagens preservados. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxFilters, visibleInboxTabs, type InboxFiltersValue } from "@/components/inbox/InboxFilters";
import type { ActiveOrg } from "@/lib/auth/types";

const activeOrgRef: { current: ActiveOrg | null } = { current: null };

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: activeOrgRef.current }),
}));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: [] }),
  channelLabel: () => "canal",
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
// Uma contagem POR ABA, para o caso de contadores poder acusar uma troca de
// chave: `automatico` é a da "Automático", `fila` é a da "Fila".
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({
    data: { fila: 3, mine: 2, all: 5, automatico: 7, closed: 4, archived: 1 },
  }),
}));

const VALUE: InboxFiltersValue = { tab: "ai", search: "", onlyUnread: false };

beforeEach(() => {
  activeOrgRef.current = { orgId: "org-1", name: "Org", role: "manager", visibility_mode: "all" };
});
afterEach(cleanup);

describe("Inbox NODZ — trabalho antes do histórico", () => {
  it("identifica a visão atual no seletor compacto", () => {
    render(<InboxFilters value={VALUE} onChange={() => {}} />);
    expect(screen.getByRole("combobox", {name:"Visualização das conversas"})).toHaveTextContent("IA atendendo · 7");
  });
  it("conserva os seis filtros e as permissões", () => {
    expect(visibleInboxTabs("manager", "all")).toEqual(["mine", "unassigned", "ai", "all", "closed", "archived"]);
    expect(visibleInboxTabs("agent", "own_and_unassigned")).toEqual(["mine", "unassigned", "ai", "closed", "archived"]);
    expect(visibleInboxTabs("agent", "own_and_sector")).toContain("all");
  });
  it.each([["mine", "Meus chats", 2], ["all", "Todos", 5], ["closed", "Concluídas", 4], ["archived", "Arquivadas", 1]] as const)("conserva o contador de %s", (tab,label,count) => {
    render(<InboxFilters value={{...VALUE,tab}} onChange={() => {}} />);
    expect(screen.getByRole("combobox",{name:"Visualização das conversas"})).toHaveTextContent(`${label} · ${count}`);
  });
});
