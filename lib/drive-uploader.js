export async function uploadToDrive(blob, filename, folderId) {
  const token = await getAuthToken();

  const metadata = {
    name: filename,
    parents: [folderId]
  };

  const boundary = '-------recording_pro_boundary';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadataPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;

  const bodyParts = [
    new Blob([metadataPart], { type: 'text/plain' }),
    new Blob([`${delimiter}Content-Type: ${blob.type}\r\nContent-Transfer-Encoding: binary\r\n\r\n`], { type: 'text/plain' }),
    blob,
    new Blob([closeDelimiter], { type: 'text/plain' })
  ];

  const body = new Blob(bodyParts);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Drive API エラー (${response.status}): ${error}`);
  }

  const result = await response.json();
  return result.id;
}

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}
