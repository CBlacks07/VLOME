import { looksLikeImage } from './uploads.controller';

describe('looksLikeImage', () => {
  it('reconnaît JPEG, PNG et WebP à leurs premiers octets', () => {
    expect(looksLikeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe(true);
    expect(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe(true);
    expect(looksLikeImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
  });

  it('refuse un autre contenu, même renommé en .png', () => {
    expect(looksLikeImage(Buffer.from('<html><script>alert(1)</script>'))).toBe(false);
    expect(looksLikeImage(Buffer.alloc(0))).toBe(false);
  });
});
