const encoder = new TextEncoder();

const crcTable = new Uint32Array(256);
for (let value = 0; value < 256; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  crcTable[value] = crc >>> 0;
}

function updateCrc32(crc, bytes) {
  let next = crc;
  for (const byte of bytes) next = (next >>> 8) ^ crcTable[(next ^ byte) & 0xff];
  return next >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(dateValue) {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(1980, safeDate.getUTCFullYear());
  return {
    time: (safeDate.getUTCHours() << 11) | (safeDate.getUTCMinutes() << 5) | Math.floor(safeDate.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((safeDate.getUTCMonth() + 1) << 5) | safeDate.getUTCDate(),
  };
}

function localHeader(nameLength, dateTime) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 0x0808);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, dateTime.time);
  writeUint16(view, 12, dateTime.date);
  writeUint16(view, 26, nameLength);
  return bytes;
}

function dataDescriptor(crc, size) {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x08074b50);
  writeUint32(view, 4, crc);
  writeUint32(view, 8, size);
  writeUint32(view, 12, size);
  return bytes;
}

function centralHeader(entry) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, 0x0808);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, entry.time);
  writeUint16(view, 14, entry.date);
  writeUint32(view, 16, entry.crc);
  writeUint32(view, 20, entry.size);
  writeUint32(view, 24, entry.size);
  writeUint16(view, 28, entry.name.length);
  writeUint32(view, 42, entry.offset);
  return bytes;
}

function endOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralSize);
  writeUint32(view, 16, centralOffset);
  return bytes;
}

async function* bodyChunks(body) {
  if (body?.getReader) {
    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value?.byteLength) yield value instanceof Uint8Array ? value : new Uint8Array(value);
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  if (body instanceof Uint8Array) {
    yield body;
    return;
  }
  if (body instanceof ArrayBuffer) {
    yield new Uint8Array(body);
    return;
  }
  throw new Error("R2 object body is unavailable");
}

async function* zipChunks(entries) {
  let offset = 0;
  const centralEntries = [];
  const emit = (bytes) => {
    offset += bytes.byteLength;
    return bytes;
  };

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const dateTime = dosDateTime(entry.date);
    const localOffset = offset;
    yield emit(localHeader(name.length, dateTime));
    yield emit(name);

    const object = await entry.getObject();
    if (!object?.body) throw new Error(`Missing object: ${entry.name}`);
    let crc = 0xffffffff;
    let size = 0;
    for await (const chunk of bodyChunks(object.body)) {
      crc = updateCrc32(crc, chunk);
      size += chunk.byteLength;
      if (size > 0xffffffff) throw new Error("ZIP entry is too large");
      yield emit(chunk);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    yield emit(dataDescriptor(crc, size));
    centralEntries.push({ name, crc, size, offset: localOffset, ...dateTime });
  }

  const centralOffset = offset;
  for (const entry of centralEntries) {
    yield emit(centralHeader(entry));
    yield emit(entry.name);
  }
  const centralSize = offset - centralOffset;
  yield emit(endOfCentralDirectory(centralEntries.length, centralSize, centralOffset));
}

export function createStoredZipStream(entries) {
  const chunks = zipChunks(entries);
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return?.();
    },
  });
}
