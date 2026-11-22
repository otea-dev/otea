// The text of rendered markup, for tests: what a person would read once the tags are gone. It walks
// the markup once, character by character, so there is no pattern to get wrong on `<<b>b>`-style
// input and no second pass that could leave a tag behind.
export function textOf(html: string): string {
  let text = '';
  let inTag = false;
  for (const char of html) {
    if (char === '<') inTag = true;
    else if (char === '>' && inTag) inTag = false;
    else if (!inTag) text += char;
  }
  return text;
}
