import PageShell from "@/components/layout/PageShell";
import BotChainGate from "@/components/botchain/BotChainGate";
import MyEnvelopesList from "@/components/envelope/MyEnvelopesList";

export default function MyEnvelopesPage() {
  return (
    <PageShell
      title="My Sealed Envelopes"
      description="Track the status of envelopes you've sent, copy share links, or reclaim expired funds."
    >
      <BotChainGate noWalletNote="Connect your wallet to view envelopes sealed from your address.">
        <MyEnvelopesList />
      </BotChainGate>
    </PageShell>
  );
}
