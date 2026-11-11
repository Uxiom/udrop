import path from 'node:path';

const FILE_CONTEXT_TABLE = {
  // Photos (SVG deliberately omitted from inlineSafe to prevent stored XSS)
  '.jpg': { category: 'photo', badge: 'PHOTO', mime: 'image/jpeg', inlineSafe: true },
  '.jpeg': { category: 'photo', badge: 'PHOTO', mime: 'image/jpeg', inlineSafe: true },
  '.png': { category: 'photo', badge: 'PHOTO', mime: 'image/png', inlineSafe: true },
  '.webp': { category: 'photo', badge: 'PHOTO', mime: 'image/webp', inlineSafe: true },
  '.gif': { category: 'photo', badge: 'PHOTO', mime: 'image/gif', inlineSafe: true },
  '.heic': { category: 'photo', badge: 'PHOTO', mime: 'image/heic', inlineSafe: true },
  '.heif': { category: 'photo', badge: 'PHOTO', mime: 'image/heif', inlineSafe: true },
  '.avif': { category: 'photo', badge: 'PHOTO', mime: 'image/avif', inlineSafe: true },
  '.bmp': { category: 'photo', badge: 'PHOTO', mime: 'image/bmp', inlineSafe: true },

  // Videos
  '.mp4': { category: 'video', badge: 'VIDEO', mime: 'video/mp4', inlineSafe: true },
  '.m4v': { category: 'video', badge: 'VIDEO', mime: 'video/mp4', inlineSafe: true },
  '.mov': { category: 'video', badge: 'VIDEO', mime: 'video/quicktime', inlineSafe: true },
  '.webm': { category: 'video', badge: 'VIDEO', mime: 'video/webm', inlineSafe: true },
  '.mkv': { category: 'video', badge: 'VIDEO', mime: 'video/x-matroska', inlineSafe: false },

  // Contact Cards
  '.vcf': { category: 'contact', badge: 'CONTACT', mime: 'text/vcard; charset=utf-8', inlineSafe: true },
  '.vcard': { category: 'contact', badge: 'CONTACT', mime: 'text/vcard; charset=utf-8', inlineSafe: true },

  // Documents
  '.pdf': { category: 'pdf', badge: 'PDF', mime: 'application/pdf', inlineSafe: true },
  '.txt': { category: 'doc', badge: 'DOC', mime: 'text/plain; charset=utf-8', inlineSafe: false },
  '.csv': { category: 'doc', badge: 'DOC', mime: 'text/csv; charset=utf-8', inlineSafe: false },
  '.md': { category: 'doc', badge: 'DOC', mime: 'text/plain; charset=utf-8', inlineSafe: false },
  '.doc': { category: 'doc', badge: 'DOC', mime: 'application/msword', inlineSafe: false },
  '.docx': { category: 'doc', badge: 'DOC', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inlineSafe: false },
  '.xls': { category: 'doc', badge: 'DOC', mime: 'application/vnd.ms-excel', inlineSafe: false },
  '.xlsx': { category: 'doc', badge: 'DOC', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inlineSafe: false },
  '.ppt': { category: 'doc', badge: 'DOC', mime: 'application/vnd.ms-powerpoint', inlineSafe: false },
  '.pptx': { category: 'doc', badge: 'DOC', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inlineSafe: false },

  // Audio
  '.mp3': { category: 'audio', badge: 'AUDIO', mime: 'audio/mpeg', inlineSafe: true },
  '.m4a': { category: 'audio', badge: 'AUDIO', mime: 'audio/mp4', inlineSafe: true },
  '.wav': { category: 'audio', badge: 'AUDIO', mime: 'audio/wav', inlineSafe: true },
  '.aac': { category: 'audio', badge: 'AUDIO', mime: 'audio/aac', inlineSafe: true },
  '.ogg': { category: 'audio', badge: 'AUDIO', mime: 'audio/ogg', inlineSafe: true },
  '.flac': { category: 'audio', badge: 'AUDIO', mime: 'audio/flac', inlineSafe: true },

  // Archives
  '.zip': { category: 'archive', badge: 'ARCHIVE', mime: 'application/zip', inlineSafe: false },
  '.rar': { category: 'archive', badge: 'ARCHIVE', mime: 'application/vnd.rar', inlineSafe: false },
  '.7z': { category: 'archive', badge: 'ARCHIVE', mime: 'application/x-7z-compressed', inlineSafe: false },
  '.tar': { category: 'archive', badge: 'ARCHIVE', mime: 'application/x-tar', inlineSafe: false },
  '.gz': { category: 'archive', badge: 'ARCHIVE', mime: 'application/gzip', inlineSafe: false }
};

const DEFAULT_CONTEXT = {
  category: 'file',
  badge: 'FILE',
  mime: 'application/octet-stream',
  inlineSafe: false
};

/**
 * Classifies a file by extension into MIME type, UI badge, and safe inline disposition flag.
 */
export function getFileContextMeta(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  return FILE_CONTEXT_TABLE[ext] || DEFAULT_CONTEXT;
}
