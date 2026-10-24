import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import SealEnvelopeForm from "@/components/envelope/SealEnvelopeForm";
import { app } from "@/lib/app-config";

export default function Home() {
  return (
    <PageShell title={app.name} description={app.tagline}>
      <BotChainGate noWalletNote="Viewing or opening an envelope by link works from any web browser.">
        <SealEnvelopeForm />
      </BotChainGate>
    </PageShell>
  );
}
