import { describe, expect, it } from 'vitest';
import { detectFileType, safeFileName } from './file-type';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p)] : p)));

describe('detectFileType', () => {
  it('recognises images, PDF and XML by their bytes', () => {
    expect(detectFileType(bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'))?.mime).toBe('image/jpeg');
    expect(detectFileType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe(
      'image/png',
    );
    expect(detectFileType(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))?.mime).toBe('image/webp');
    expect(detectFileType(bytes('%PDF-1.7\n'))?.ext).toBe('pdf');
    expect(detectFileType(bytes([0xef, 0xbb, 0xbf], '\r\n <?xml version="1.0"?><HDon/>'))?.ext).toBe('xml');
  });

  it('rejects anything else, whatever its name says', () => {
    expect(detectFileType(bytes('MZ\x90\x00'))).toBeNull();
    expect(detectFileType(bytes('hello'))).toBeNull();
    expect(detectFileType(bytes('<xml', [0xff, 0xfe]))).toBeNull(); // not valid UTF-8
    expect(detectFileType(new Uint8Array())).toBeNull();
  });
});

describe('safeFileName', () => {
  it('drops folders and odd characters and forces the detected extension', () => {
    expect(safeFileName('C:\\fakepath\\Hoá đơn "bò".png', 'jpg')).toBe('Hoá đơn bò.jpg');
    expect(safeFileName('../../etc/passwd', 'pdf')).toBe('passwd.pdf');
    expect(safeFileName('', 'xml')).toBe('chung-tu.xml');
  });
});
