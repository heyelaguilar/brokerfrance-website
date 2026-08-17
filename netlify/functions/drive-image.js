// Proxies a single Google Drive file's image bytes through our own domain.
// Needed for link-preview crawlers (WhatsApp, Facebook, iMessage): Drive's
// uc?export=view URL replies with a 303 redirect rather than the image
// itself, and most of those crawlers won't follow it — same reason
// drive-folder.js proxies folder listings instead of linking to Drive.
exports.handler = async (event) => {
  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return { statusCode: 400, body: 'Invalid file id' };
  }
  try {
    const res = await fetch(`https://drive.google.com/uc?export=view&id=${id}`, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) throw new Error('Not an image: ' + contentType);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
      isBase64Encoded: true,
      body: buf.toString('base64'),
    };
  } catch (err) {
    console.error('drive-image error:', err);
    return { statusCode: 302, headers: { Location: `https://drive.google.com/uc?export=view&id=${id}` }, body: '' };
  }
};
