import { Directory, File, Paths } from 'expo-file-system';

const inflight = new Map();

function artworkDirectory() {
  const directory = new Directory(Paths.cache, 'trakt-art');
  directory.create({ idempotent: true });
  return directory;
}

function fileName(remotePath) {
  let hash = 2166136261;
  const value = String(remotePath);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}.webp`;
}

export function artworkRemoteUrl(remotePath) {
  if (!remotePath || typeof remotePath !== 'string') {
    return null;
  }
  if (remotePath.includes('..') || remotePath.includes(' ')) {
    return null;
  }
  const withProtocol = remotePath.startsWith('https://') ? remotePath : `https://${remotePath}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname.endsWith('trakt.tv')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function cachedArtworkUri(remotePath) {
  const remoteUrl = artworkRemoteUrl(remotePath);
  if (!remoteUrl) {
    return null;
  }
  const name = fileName(remotePath);
  const file = new File(artworkDirectory(), name);
  if (file.exists) {
    return file.uri;
  }
  const pending = inflight.get(name);
  if (pending) {
    return pending;
  }
  const download = File.downloadFileAsync(remoteUrl, file, {
    idempotent: true,
    headers: {
      Accept: 'image/webp,image/*',
      'User-Agent': 'Seenzo/1.0.0',
    },
  })
    .then((output) => output.uri)
    .catch(() => null)
    .finally(() => inflight.delete(name));
  inflight.set(name, download);
  return download;
}
