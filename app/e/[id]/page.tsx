"use client";

import { use } from "react";
import PageShell from "@/components/layout/PageShell";
import OpenEnvelopeCard from "@/components/envelope/OpenEnvelopeCard";

interface EnvelopePageProps {
  params: Promise<{ id: string }>;
}

export default function EnvelopeDetailPage({ params }: EnvelopePageProps) {
  const resolvedParams = use(params);
  let id: bigint;
  try {
    id = BigInt(resolvedParams.id);
  } catch {
    id = 0n;
  }

  return (
    <PageShell
      title={`Envelope #${resolvedParams.id}`}
      description="Time-sealed BOT transfer on BOT Chain."
    >
      <OpenEnvelopeCard id={id} />
    </PageShell>
  );
}
