/** Histórico permanece acessível fora das visões de trabalho. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  InboxFilters,
} from "@/components/inbox/InboxFilters";

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    activeOrg: { orgId: "org-1", name: "Org", role: "manager", visibility_mode: "all" },
  }),
}));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  channelLabel: (c: { display_name: string }) => c.display_name,
  useChannelSessions: () => ({ data: [] }),
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
// Contagens de 2 dígitos, como numa instalação viva: elas ALARGAM a aba, e é
// com elas que o corte foi medido.
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({
    data: { fila: 47, automatico: 12, mine: 8, all: 130, closed: 25, archived: 9 },
  }),
}));


afterEach(cleanup);

describe("Histórico separado sem perder acesso", () => {
  it("abre as duas visões de histórico e mantém o identificador da aba", () => {
    const onChange=vi.fn();
    render(<InboxFilters value={{tab:"mine",search:"",onlyUnread:false}} onChange={onChange} />);
    expect(screen.queryByRole("option",{name:/Arquivadas/})).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox",{name:"Visualização das conversas"}),{key:"ArrowDown"});
    expect(screen.getByRole("option",{name:/Concluídas/})).toBeVisible();
    fireEvent.click(screen.getByRole("option",{name:/Arquivadas/}));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({tab:"archived"}));
  });
  it("link direto para arquivadas abre o histórico", () => {
    render(<InboxFilters value={{tab:"archived",search:"",onlyUnread:false}} onChange={()=>{}} />);
    expect(screen.getByRole("combobox",{name:"Visualização das conversas"})).toHaveTextContent("Arquivadas · 9");
  });
});
