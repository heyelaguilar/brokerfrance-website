// Lists the image files inside a public Google Drive folder without needing
// a Drive API key, by proxying Google's embedded folder view (used for
// embedding folders on web pages) and parsing out file entries.
exports.handler = async (event) => {
  const folderId = event.queryStringParameters && event.queryStringParameters.id;
  if (!folderId || !/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid folder id' }) };
  }

  try {
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#grid`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();

    const unescapeHtml = s => s
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const imageExt = /\.(jpe?g|png|webp|gif|heic|bmp)$/i;
    const entryRe = /<div class="flip-entry" id="entry-([a-zA-Z0-9_-]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
    const images = [];
    let m;
    while ((m = entryRe.exec(html))) {
      const [, id, rawName] = m;
      const name = unescapeHtml(rawName.trim());
      if (imageExt.test(name)) images.push({ id, name });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({ images }),
    };
  } catch (err) {
    console.error('drive-folder error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load folder' }) };
  }
};
