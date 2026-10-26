import Link from "next/link";
import PageShell from "@/components/layout/PageShell";
import Panel from "@/components/ui/Panel";

export default function NotFound() {
  return (
    <PageShell title="Envelope Not Found" description="The requested letter or envelope does not exist.">
      <div className="py-8 w-full max-w-[500px]">
        <Panel className="text-center py-12 space-y-4 bg-[#FDFCFA] border-[#A88B55]/50">
          <div className="text-4xl font-serif text-[#A88B55]">✉️</div>
          <h2 className="text-xl font-serif font-bold text-[#2A1D0E]">
            Envelope Not Found
          </h2>
          <p className="text-xs text-[#4A3A1F] max-w-xs mx-auto">
            This sealed envelope record could not be found on this network.
          </p>
          <div className="pt-4">
            <Link
              href="/"
              className="inline-flex items-center px-4 py-2 text-xs font-serif font-bold rounded bg-[#A88B55] text-white hover:bg-[#8D7344] transition-colors"
            >
              ← Seal an envelope
            </Link>
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
