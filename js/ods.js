// 自製 OpenDocument 試算表（.ods）產生器：不依賴第三方元件
// 介面刻意和原本用的 SheetJS 相同（utils.book_new／aoa_to_sheet／book_append_sheet），其他程式不用大改
// ODS 本質是 zip：第一個檔案必須是未壓縮的 mimetype，其餘為 XML
export const MIME = 'application/vnd.oasis.opendocument.spreadsheet';

const esc = (v) => String(v)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '') // XML 不允許的控制字元
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const utils = {
  book_new: () => ({ sheets: [] }),
  aoa_to_sheet: (rows) => ({ rows: rows.map((r) => (Array.isArray(r) ? r : [r])) }),
  book_append_sheet(wb, ws, name) {
    // 工作表名稱：去掉試算表不允許的字元，最長 31 字，重名時加序號
    let base = String(name || `Sheet${wb.sheets.length + 1}`).replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
    let n = base, i = 2;
    while (wb.sheets.some((x) => x.name === n)) n = `${base.slice(0, 28)}(${i++})`;
    wb.sheets.push({ ...ws, name: n });
  },
};

function cell(v, bold) {
  const st = bold ? ' table:style-name="ceH"' : '';
  if (v === null || v === undefined || v === '') return `<table:table-cell${st}/>`;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return `<table:table-cell${st} office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`;
  }
  if (typeof v === 'boolean') {
    return `<table:table-cell${st} office:value-type="boolean" office:boolean-value="${v}"><text:p>${v ? 'TRUE' : 'FALSE'}</text:p></table:table-cell>`;
  }
  const ps = String(v).split(/\r?\n/).map((t) => `<text:p>${esc(t)}</text:p>`).join('');
  return `<table:table-cell${st} office:value-type="string">${ps}</table:table-cell>`;
}

function contentXML(wb) {
  // 欄寬：每種寬度建一個欄樣式（wch 約為字元數，換算成公分）
  const widths = [...new Set(wb.sheets.flatMap((s) => (s['!cols'] || []).map((c) => c.wch)))];
  const colStyle = (w) => `co${widths.indexOf(w)}`;
  const colStyles = widths.map((w, i) =>
    `<style:style style:name="co${i}" style:family="table-column"><style:table-column-properties style:column-width="${(w * 0.21 + 0.2).toFixed(2)}cm"/></style:style>`).join('');
  const tables = wb.sheets.map((s) => {
    const ncol = Math.max(1, ...s.rows.map((r) => r.length));
    const cols = s['!cols'] || [];
    let colXML = '';
    for (let c = 0; c < ncol; c++) {
      const w = cols[c]?.wch;
      colXML += w ? `<table:table-column table:style-name="${colStyle(w)}" table:default-cell-style-name="Default"/>` : '<table:table-column table:default-cell-style-name="Default"/>';
    }
    const rowsXML = s.rows.map((r, ri) =>
      `<table:table-row>${r.map((v) => cell(v, ri === 0)).join('')}</table:table-row>`).join('');
    return `<table:table table:name="${esc(s.name)}">${colXML}${rowsXML || '<table:table-row><table:table-cell/></table:table-row>'}</table:table>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
    + ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
    + ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
    + ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
    + ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">'
    + `<office:automatic-styles>${colStyles}`
    + '<style:style style:name="ceH" style:family="table-cell" style:parent-style-name="Default"><style:text-properties fo:font-weight="bold"/></style:style>'
    + '</office:automatic-styles>'
    + `<office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body></office:document-content>`;
}

const MANIFEST = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
  + `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME}"/>`
  + '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
  + '</manifest:manifest>';

// ---------- 最小 zip（不壓縮，STORE） ----------
let CRC;
function crc32(buf) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); // UTF-8 檔名旗標
    h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: MIME });
}

/** 把活頁簿寫成 .ods 的 Blob */
export function odsBlob(wb) {
  return zip([
    ['mimetype', MIME], // 必須是第一個且不壓縮
    ['META-INF/manifest.xml', MANIFEST],
    ['content.xml', contentXML(wb)],
  ]);
}
