"use client";

import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";

/** O nó `gravar_campo` no canvas (Parte 1 do motor de fluxo). */
export function GravarCampoNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.gravar_campo}
      label={data.label}
      subtitle={describeNodeConfig("gravar_campo", data.config, t)}
      selected={selected}
      errors={data.errors}
    />
  );
}
