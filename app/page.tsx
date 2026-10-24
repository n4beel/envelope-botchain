import PageShell from "@/components/layout/PageShell";
import SealEnvelopeForm from "@/components/envelope/SealEnvelopeForm";
import { app } from "@/lib/app-config";

export default function Home() {
  return (
    <PageShell title={app.name} description={app.tagline}>
      <SealEnvelopeForm />
    </PageShell>
  );
}

