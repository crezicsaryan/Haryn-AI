import { Code, ExternalLink } from "lucide-react";
import { Section } from "@/components/ui/primitives";

const ASCII_PORTRAIT = [
  "iii>>><<<<~~+++__----???]]]]]][[[[[[[[[]]]??---____+++~~<<<<>>ii!!!!ll",
  "i>>><<<~~~++___--???]][[[}}}{{1{{{{{{{}}}[[[]]??--___++~~~~<<>>>i!!!!l",
  ">>><<<~~++__--??]][}}}{{1)1]?_<>+]]]}{1))1{{}}[]]??--__+++~~~<<>>ii!!!",
  "><<<~~++__--??][[}{11)(1[<;:lI;!~~+~>!_+>>[1)11{}[[]??-___++~~~<>>ii!!",
  "<<<~~++__-??][}{{1)((]>lI;I<!l!!;,,\"\"I]1]}{}<Il_11{}[[]??-___++~~<<>>i!",
  "<<~~+__-??][}}{1)((_!^\"\"l,,:`\"\"!!` .\"\"!<~~_-!\",!~>_[{1{}[]??--__+~~<<>>>i",
  "<~++__-??][}{11(|/_.'^:'^, ',,  ',lI:I!:'':i_1{[+![{{}[]]?--_++~~<<>>i",
  "~~+__-??]][{1)(|)~I''\"\"^'^` \"\"^. `\"\"\"\"^'^^'.^II;,'\"\"`^I+<>}1}}[]?--_++~~<<>>",
  "~+__-??][[}{)(|/|+,`.'^`''.`. '''.  ...'\"\"`.  .`I_-+<{){{}[]?-__++~<<>>",
  "++_--?][}{{1(|/tf)I,,`'..`:<i>]{}}[-_+<l::\"\"..`,I!!i_((1{}[[]?-__+~~<<>",
  "+_--?][}{{1)(|/ttr[I,'`..`,l!;I:l!I!lII;\"\".`',I;I!i~|({11{}[]?--_+~~<<>",
  "_--??][}{{1)((|/tf(>:\"\"`.'\"\";IIlII;IIIIII;I,`'.^\"\"I~_1)1{{}[]?--_+~~<<>",
  "--??][[}{{1)(|/tfjt)_^`..`.^IIIIIIIIIIIIIIII;,'`.'^!<})11{}[[]?--_+~~<<",
  "-??][[}{{11)(|/tfjrx)_^`...`^;IIIIIIIIIIIIIIII;,'.`^I~})11{}[[]??-_+~~<<",
  "??][[}{{111)(|/tfjrxnu_^`...`'^;IIIIIIIIIIIIII;,'`^I~})11{}[[]??--_+~~<",
  "?][[}{{111)(|/tfjrxnuv<_^`...`',;IIIIIIIIIIII;,'`^I~)1){}[[]]??--_+~~<<",
  "?][[}{{111)(|/tfjrxnuvc<_^`...`',;IIIIIIIIII;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvcz<_^`...`',;IIIIIIII;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczX<_^`...`',;IIIIII;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXY<_^`...`',;IIII;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYU<_^`...`',;II;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJ<_^`...`',;I;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJC<_^`...`',;,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCL<_^`...`',,'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ<_^`...`',`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0<_^`...`'`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0O<_^`...`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZ<_^`...`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZm<_^`...^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZmw<_^`..^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZmwq<_^`.^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZmwqp<_^`^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZmwqpd<_^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbk<_^I~}1){}[[]]??--_++~~<<",
  "?][[}{{111)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*MW&%#@",
];

export function DeveloperInfo() {
  return (
    <Section id="developer" eyebrow="Built by" title="The engineer behind it">
      <div className="overflow-hidden rounded-xl border border-hair bg-surface shadow-sm">
        <div className="grid gap-px bg-hair lg:grid-cols-[340px_1fr]">
          {/* ASCII Portrait */}
          <div className="flex items-center justify-center bg-surface p-6 sm:p-8">
            <pre
              className="font-mono text-[5.5px] leading-[5.5px] text-ink-2 select-none"
              aria-label="ASCII portrait of the developer"
            >
              {ASCII_PORTRAIT.join("\n")}
            </pre>
          </div>

          {/* Bio + Links */}
          <div className="flex flex-col justify-center bg-surface p-6 sm:p-8 lg:p-10">
            <h3 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
              Aryan Singh
            </h3>
            <p className="mt-1 text-[13px] font-medium text-brand-600">
              Engineer in the making
            </p>

            <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-ink-2">
              Questioning the obvious. Building beyond the expected. Every tool
              here was built because I needed it first — then refined until it
              could stand on its own.
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
