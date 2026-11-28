// An option the person taps is their answer, in the first person. One that promises they will write
// or explain something themselves ("te escribo las fechas", "I'll write the date in my answer") is
// sent at once as it reads, and the agent has to ask again (field study 5, V7/V2: 3 of 3 taps). The
// agent marks such an option (--option-text); this is the net under it: a label that promises the
// person's own words opens the text box whether it was marked or not.
const ES = [
  /\b(?:te|le|se)\s+(?:lo\s+|la\s+|los\s+|las\s+)?(?:escribo|explico|detallo|aclaro|cuento|comento|especifico|indico|digo|paso|mando)\b/i,
  /\b(?:lo|la|los|las)\s+(?:escribo|explico|detallo|aclaro|especifico|indico)\b/i,
  /\bescribo\s+(?:la|el|lo|los|las|un|una|cu[aá]nt[oa]s?|cu[aá]ndo|c[oó]mo|qu[eé]|d[oó]nde)\b/i,
  /\b(?:en|con)\s+mi\s+(?:respuesta|texto|mensaje|nota)\b/i,
  /\bal\s+(?:responder|contestar)\b/i,
];

const EN = [
  /\bI(?:'ll|\s+will|\s+can|\s+would)?\s+(?:write|type|explain|spell\s+out|describe|detail|specify|tell\s+you|give\s+you|send\s+you)\b/i,
  /\blet\s+me\s+(?:write|type|explain|describe|spell|say)\b/i,
  /\b(?:in|with)\s+my\s+(?:own\s+words|answer|reply|response|message|note)\b/i,
  /\bwhen\s+I\s+(?:answer|reply|respond)\b/i,
];

export function promisesOwnWords(label: string): boolean {
  return [...ES, ...EN].some((pattern) => pattern.test(label));
}

// The numbers (from 1) of the options that need the person's own words: the ones the agent marked,
// and every one whose label promises them.
export function optionsNeedingWords(
  options: readonly string[],
  marked: readonly number[] = [],
): number[] {
  return options
    .map((_, index) => index + 1)
    .filter((number) => marked.includes(number) || promisesOwnWords(options[number - 1] ?? ''));
}
