const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const {
  getAudioFilePath,
  isGeneratedAudioFilename,
} = require('../services/TTSService');

const router = express.Router();

function parseRange(rangeHeader, fileSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match) return null;

  let start = match[1] === '' ? null : Number(match[1]);
  let end = match[2] === '' ? null : Number(match[2]);

  if (start === null && end === null) return null;

  if (start === null) {
    const suffixLength = end;
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    if (!Number.isInteger(start) || start < 0) return null;
    if (end === null) end = fileSize - 1;
  }

  if (!Number.isInteger(end) || end < start || start >= fileSize) return null;

  return {
    start,
    end: Math.min(end, fileSize - 1),
  };
}

router.get('/audio/:filename', async (req, res, next) => {
  const { filename } = req.params;

  if (!isGeneratedAudioFilename(filename)) {
    return res.status(400).json({ error: 'Invalid audio filename' });
  }

  let filePath;
  let stat;

  try {
    filePath = getAudioFilePath(filename);
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Audio file not found or expired' });
    }
    if (error.message === 'Invalid audio filename' || error.message === 'Invalid audio path') {
      return res.status(400).json({ error: 'Invalid audio filename' });
    }
    return next(error);
  }

  const fileSize = stat.size;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
    'Content-Type': 'audio/mpeg',
  };

  if (req.headers.range) {
    const range = parseRange(req.headers.range, fileSize);
    if (!range) {
      return res
        .status(416)
        .set('Content-Range', `bytes */${fileSize}`)
        .json({ error: 'Invalid range' });
    }

    const contentLength = range.end - range.start + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Length': contentLength,
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`,
    });

    return fs
      .createReadStream(filePath, { start: range.start, end: range.end })
      .on('error', next)
      .pipe(res);
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': fileSize,
  });

  return fs
    .createReadStream(filePath)
    .on('error', next)
    .pipe(res);
});

module.exports = router;
