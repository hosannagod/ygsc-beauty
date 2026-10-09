import { fail } from "./workflow.js";
// Reject oversized/ZIP64 archives before ExcelJS expands XML into memory.
export function validateWorkbookArchive(buffer: Buffer) {
  if (buffer.length > 2 * 1024 * 1024 || buffer.length < 22)
    fail("2MB 이하의 XLSX 파일이 필요합니다.");
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0
  )
    fail("지원하지 않는 XLSX 압축 형식입니다.");
  const count = buffer.readUInt16LE(end + 10),
    size = buffer.readUInt32LE(end + 12),
    start = buffer.readUInt32LE(end + 16);
  if (
    count > 200 ||
    count === 0 ||
    size === 0xffffffff ||
    start === 0xffffffff ||
    start + size > end
  )
    fail("XLSX 압축 크기가 허용 범위를 초과했습니다.");
  let offset = start,
    total = 0;
  for (let n = 0; n < count; n++) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x02014b50
    )
      fail("손상된 XLSX 파일입니다.");
    const flags = buffer.readUInt16LE(offset + 8),
      uncompressed = buffer.readUInt32LE(offset + 24);
    total += uncompressed;
    if (flags & 1 || uncompressed > 8 * 1024 * 1024 || total > 16 * 1024 * 1024)
      fail("압축 해제 크기가 너무 크거나 암호화된 XLSX 파일입니다.");
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
    if (offset > start + size) fail("손상된 XLSX 파일입니다.");
  }
  if (offset !== start + size) fail("손상된 XLSX 파일입니다.");
}
