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
    if (url.protocol !== 'https:' || !url.hostname.endsWith('trakt.tv')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
