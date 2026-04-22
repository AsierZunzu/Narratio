import { describe, it, expect } from 'vitest';
import { htmlToText } from '../../src/utils/html.js';

describe('htmlToText', () => {
  it('converts basic HTML paragraph to plain text', () => {
    const result = htmlToText('<p>Hello world</p>');
    expect(result).toBe('Hello world');
  });

  it('strips link hrefs but keeps link text', () => {
    const result = htmlToText('<p>Read <a href="https://example.com">more here</a>.</p>');
    expect(result).toContain('more here');
    expect(result).not.toContain('https://example.com');
  });

  it('skips img tags entirely', () => {
    const result = htmlToText('<p>Text</p><img src="photo.jpg" alt="photo"><p>After</p>');
    expect(result).not.toContain('photo');
    expect(result).toContain('Text');
    expect(result).toContain('After');
  });

  it('skips figure elements', () => {
    const result = htmlToText('<p>Before</p><figure><img src="x.jpg"><figcaption>caption</figcaption></figure><p>After</p>');
    expect(result).not.toContain('caption');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('handles nested HTML', () => {
    const result = htmlToText('<div><h1>Title</h1><p>Para <strong>bold</strong> text.</p></div>');
    // html-to-text uppercases heading text by default
    expect(result).toContain('TITLE');
    expect(result).toContain('bold');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('strips HTML tags from plain text content', () => {
    const result = htmlToText('<p>Hello &amp; world</p>');
    expect(result).toBe('Hello & world');
  });
});
