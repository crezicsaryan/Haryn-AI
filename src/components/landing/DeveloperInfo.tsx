import Image from "next/image";
import { Code, ExternalLink } from "lucide-react";
import { Section } from "@/components/ui/primitives";

export function DeveloperInfo() {
  return (
    <Section id="developer" eyebrow="Built by" title="The engineer behind it">
      <div className="overflow-hidden rounded-xl border border-hair bg-surface shadow-sm">
        <div className="grid gap-px bg-hair lg:grid-cols-[340px_1fr]">
          {/* Portrait */}
          <div className="relative aspect-square bg-surface-2 lg:aspect-auto lg:min-h-[340px]">
            <Image
              src="/aryan-singh.jpg"
              alt="Aryan Singh"
              fill
              sizes="(max-width: 1024px) 100vw, 340px"
              className="object-cover"
            />
          </div>

          {/* Bio + Links */}
          <div className="flex flex-col justify-center bg-surface p-6 sm:p-8 lg:p-10">
            <h3 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              Aryan Singh
            </h3>

            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-2">
              Engineer in the making. Questioning the obvious. Building beyond
              the expected.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href="https://github.com/crezicsaryan"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-pill border border-hair bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-hair-strong hover:text-ink"
              >
                <Code className="h-4 w-4 text-ink-3" />
                GitHub
              </a>
              <a
                href="https://www.linkedin.com/in/aryan-singh-616791332"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-pill border border-hair bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-hair-strong hover:text-ink"
              >
                <ExternalLink className="h-4 w-4 text-ink-3" />
                LinkedIn
              </a>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
