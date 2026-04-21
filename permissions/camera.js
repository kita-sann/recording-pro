const btn = document.getElementById('grant-btn');
const statusEl = document.getElementById('status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = '許可を要求中...';
  try {
    const params = new URLSearchParams(location.search);
    const needAudio = params.get('audio') !== 'false';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: needAudio
    });
    stream.getTracks().forEach(t => t.stop());
    statusEl.textContent = 'カメラアクセスが許可されました！このタブを閉じてください。';
    statusEl.className = 'status success';
    btn.textContent = '許可済み';
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      statusEl.textContent = 'カメラアクセスが拒否されました。アドレスバーのカメラアイコンから許可してください。';
    } else {
      statusEl.textContent = 'エラー: ' + e.message;
    }
    statusEl.className = 'status error';
    btn.disabled = false;
    btn.textContent = '再試行';
  }
});
