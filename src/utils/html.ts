import { convert } from 'html-to-text';

export function htmlToText(html: string): string {
  return convert(html, {
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'figure', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
    wordwrap: false,
  }).trim();
}
